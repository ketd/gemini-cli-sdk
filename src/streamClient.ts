/**
 * GeminiStreamClient - Persistent stream-based client for Gemini CLI
 *
 * Architecture:
 * - 1 Client = 1 Node.js Process = 1 Session
 * - Communication via stdin/stdout JSONL
 * - Process stays alive for multiple message exchanges
 * - Similar to Claude Agent SDK's SubprocessCLITransport
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Writable } from 'node:stream';
import {
  GeminiStreamOptions,
  JsonStreamEvent,
  JsonStreamEventType,
  JsonInputMessage,
  JsonInputMessageType,
  InitEvent,
  GeminiSDKError,
  ProcessStatus,
} from './types.js';
import { createLogger, LogLevel, type SDKLogger } from './logger.js';

/**
 * Events emitted by GeminiStreamClient
 */
export interface StreamClientEvents {
  /** JSON stream event from CLI */
  event: (event: JsonStreamEvent) => void;

  /** Process started */
  started: () => void;

  /** Process ready (INIT event received) */
  ready: (initEvent: InitEvent) => void;

  /** Process stopped */
  stopped: (code: number | null) => void;

  /** Error occurred */
  error: (error: Error) => void;
}

export declare interface GeminiStreamClient {
  on<K extends keyof StreamClientEvents>(event: K, listener: StreamClientEvents[K]): this;
  emit<K extends keyof StreamClientEvents>(event: K, ...args: Parameters<StreamClientEvents[K]>): boolean;
}

/**
 * GeminiStreamClient
 *
 * Manages a persistent Gemini CLI process for stream-based communication.
 *
 * @example
 * ```typescript
 * const client = new GeminiStreamClient({
 *   pathToGeminiCLI: './gemini.js',
 *   sessionId: 'session-123',
 *   apiKey: process.env.GEMINI_API_KEY,
 * });
 *
 * client.on('event', (event) => {
 *   console.log('Event:', event);
 * });
 *
 * await client.start();
 * await client.sendMessage('Hello, Gemini!');
 * await client.stop();
 * ```
 */
export class GeminiStreamClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdinStream: Writable | null = null;
  private readlineInterface: readline.Interface | null = null;
  private status: ProcessStatus = ProcessStatus.IDLE;
  private initEvent: InitEvent | null = null;
  private initTimeout: NodeJS.Timeout | null = null;
  private tempSettingsPath: string | null = null;
  private logger: SDKLogger;

  constructor(private options: GeminiStreamOptions) {
    super();

    // Initialize logger
    this.logger = createLogger('GeminiStreamClient', {
      logger: options.logger,
      level: options.debug ? LogLevel.DEBUG : LogLevel.INFO,
    });

    // Validate required options
    if (!options.pathToGeminiCLI) {
      throw new GeminiSDKError('pathToGeminiCLI is required');
    }
    if (!options.sessionId) {
      throw new GeminiSDKError('sessionId is required');
    }
  }

  /**
   * Start the Gemini CLI process
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new GeminiSDKError('Process already started');
    }

    this.status = ProcessStatus.RUNNING;

    // Create temporary settings.json if hooks or mcpServers are configured
    if (this.options.hooks || this.options.mcpServers) {
      await this.createTempSettings();
    }

    // Build command arguments
    const args = this.buildCommand();

    // Build environment variables
    const env = this.buildEnv();

    // Use custom Node.js path if provided, otherwise default to 'node'
    const nodeExecutable = this.options.pathToNode || 'node';

    // Spawn process
    this.process = spawn(nodeExecutable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.cwd || process.cwd(),
      env,
    });

    // Handle process events
    this.process.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    this.process.on('error', (error) => {
      this.handleProcessError(error);
    });

    // Setup stdin stream
    if (this.process.stdin) {
      this.stdinStream = this.process.stdin;
      // CRITICAL: Set encoding to prevent stdin from auto-closing
      this.stdinStream.setDefaultEncoding('utf-8');
      // IMPORTANT: Don't end stdin prematurely - keep it alive
      // The readline loop in CLI will wait for messages
    } else {
      throw new GeminiSDKError('Failed to get stdin stream');
    }

    // Setup stdout readline interface
    if (this.process.stdout) {
      this.readlineInterface = readline.createInterface({
        input: this.process.stdout,
        terminal: false, // CRITICAL: Non-terminal mode for JSONL
      });

      // Start reading events
      this.startReadLoop();
    } else {
      throw new GeminiSDKError('Failed to get stdout stream');
    }

    // Handle stderr (always process to prevent mixing with stdout)
    if (this.process.stderr) {
      this.process.stderr.on('data', (chunk) => {
        const message = chunk.toString().trim();
        // Skip informational messages that are not real errors
        if (!message || message.includes('Flushing log events')) {
          return;
        }
        // Log actual errors/warnings
        this.logger.error('stderr:', message);
      });
    }

    this.emit('started');

    // Wait for INIT event
    await this.waitForInit();
  }

  /**
   * Send a user message to the CLI
   * @param content - User message content
   * @param temporarySystemInstruction - Optional temporary system instruction to append for this request only
   */
  async sendMessage(content: string, temporarySystemInstruction?: string): Promise<void> {
    if (!this.isReady()) {
      throw new GeminiSDKError('Client not ready. Call start() first.');
    }

    const message: JsonInputMessage = {
      type: JsonInputMessageType.USER,
      content,
      session_id: this.options.sessionId,
      temporary_system_instruction: temporarySystemInstruction,
    };

    this.writeMessage(message);
  }

  /**
   * Send an interrupt control command
   */
  async interrupt(): Promise<void> {
    if (!this.isReady()) {
      throw new GeminiSDKError('Client not ready. Call start() first.');
    }

    const message: JsonInputMessage = {
      type: JsonInputMessageType.CONTROL,
      control: {
        subtype: 'interrupt',
      },
      session_id: this.options.sessionId,
    };

    this.writeMessage(message);
  }

  /**
   * Truncate chat history from a specific index
   *
   * This sends a control message to the CLI to:
   * 1. Truncate in-memory history (via GeminiChat.setHistory())
   * 2. Sync to session.json file (via ChatRecordingService)
   *
   * Used for edit/retry functionality where subsequent messages need to be discarded.
   *
   * @param fromIndex - Index from which to truncate (0-based, inclusive)
   */
  async truncateHistory(fromIndex: number): Promise<void> {
    if (!this.isReady()) {
      throw new GeminiSDKError('Client not ready. Call start() first.');
    }

    if (fromIndex < 0) {
      throw new GeminiSDKError('fromIndex must be non-negative');
    }

    const message: JsonInputMessage = {
      type: JsonInputMessageType.CONTROL,
      control: {
        subtype: 'truncate_history',
        fromIndex,
      },
      session_id: this.options.sessionId,
    };

    this.writeMessage(message);
  }

  /**
   * Resume session from a session file
   *
   * This sends a control message to the CLI to:
   * 1. Load history from the specified session file
   * 2. Update the ChatRecordingService to use the session file
   *
   * Used when a warm pool adapter is assigned to a real session that has history.
   *
   * @param sessionFilePath - Path to the session file to resume from
   */
  async resumeSession(sessionFilePath: string): Promise<void> {
    if (!this.isReady()) {
      throw new GeminiSDKError('Client not ready. Call start() first.');
    }

    if (!sessionFilePath) {
      throw new GeminiSDKError('sessionFilePath is required');
    }

    const message: JsonInputMessage = {
      type: JsonInputMessageType.CONTROL,
      control: {
        subtype: 'resume_session',
        sessionFilePath,
      },
      session_id: this.options.sessionId,
    };

    this.writeMessage(message);
  }

  /**
   * Stop the CLI process
   */
  async stop(timeout: number = 5000): Promise<void> {
    if (!this.process) {
      return;
    }

    // Clear init timeout if exists
    if (this.initTimeout) {
      clearTimeout(this.initTimeout);
      this.initTimeout = null;
    }

    // Close stdin to signal graceful shutdown
    if (this.stdinStream) {
      this.stdinStream.end();
      this.stdinStream = null;
    }

    // Close readline interface
    if (this.readlineInterface) {
      this.readlineInterface.close();
      this.readlineInterface = null;
    }

    // Wait for process to exit (with timeout)
    await Promise.race([
      new Promise<void>((resolve) => {
        if (this.process) {
          this.process.once('exit', () => resolve());
        } else {
          resolve();
        }
      }),
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    ]);

    // Force kill if still running
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');

      // Wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // SIGKILL if still not dead
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }

    this.process = null;
    this.status = ProcessStatus.COMPLETED;

    // Clean up temporary settings file
    if (this.tempSettingsPath) {
      try {
        fs.unlinkSync(this.tempSettingsPath);
        this.logger.debug('Cleaned up temp settings:', this.tempSettingsPath);
      } catch (error) {
        this.logger.error('Failed to clean up temp settings:', error);
      }
      this.tempSettingsPath = null;
    }
  }

  /**
   * Check if client is ready to send messages
   */
  isReady(): boolean {
    return this.status === ProcessStatus.RUNNING && this.initEvent !== null;
  }

  /**
   * Get current status
   */
  getStatus(): ProcessStatus {
    return this.status;
  }

  /**
   * Get init event (contains session_id, model, etc.)
   */
  getInitEvent(): InitEvent | null {
    return this.initEvent;
  }

  /**
   * Get process PID
   */
  getPid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Create settings.json in GEMINI_CONFIG_DIR for hooks and MCP servers configuration
   *
   * Note: Gemini CLI does not support --settings-file parameter.
   * Instead, it loads settings from GEMINI_CONFIG_DIR/settings.json
   * where GEMINI_CONFIG_DIR is set via environment variable.
   */
  private async createTempSettings(): Promise<void> {
    // Get GEMINI_CONFIG_DIR from options.env
    const geminiConfigDir = this.options.env?.GEMINI_CONFIG_DIR;

    if (!geminiConfigDir) {
      throw new GeminiSDKError(
        'GEMINI_CONFIG_DIR is required in options.env when using hooks or mcpServers. ' +
        'Please set options.env.GEMINI_CONFIG_DIR to a directory path.'
      );
    }

    // Ensure the directory exists
    if (!fs.existsSync(geminiConfigDir)) {
      fs.mkdirSync(geminiConfigDir, { recursive: true });
      this.logger.debug('Created config directory:', geminiConfigDir);
    }

    // Write settings.json to GEMINI_CONFIG_DIR
    this.tempSettingsPath = path.join(geminiConfigDir, 'settings.json');

    // Build settings object
    const settings: Record<string, unknown> = {};

    // Add hooks configuration if provided
    if (this.options.hooks) {
      settings.tools = {
        enableHooks: true,
      };
      settings.hooks = this.options.hooks;
    }

    // Add MCP servers configuration if provided
    if (this.options.mcpServers) {
      settings.mcpServers = this.options.mcpServers;
    }

    try {
      fs.writeFileSync(this.tempSettingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      this.logger.debug('Wrote settings to:', this.tempSettingsPath);
      this.logger.debug('Settings content:', JSON.stringify(settings, null, 2));
    } catch (error) {
      throw new GeminiSDKError(`Failed to write settings file: ${error}`);
    }
  }

  /**
   * Build CLI command arguments
   */
  private buildCommand(): string[] {
    const args = [
      this.options.pathToGeminiCLI,
      '--stream-json-input', // ← New flag we'll add to CLI
      '--output-format',
      'stream-json',
    ];

    // Note: Do NOT use --settings-file as it's not supported by Gemini CLI
    // Settings are loaded from GEMINI_CONFIG_DIR/settings.json instead

    // Resume from previous session file
    if (this.options.resumeSessionFilePath) {
      args.push('--resume-from-file', this.options.resumeSessionFilePath);
      this.logger.debug('Resuming from session file:', this.options.resumeSessionFilePath);
    }

    // Model
    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    // Approval mode
    if (this.options.approvalMode) {
      args.push('--approval-mode', this.options.approvalMode);
    }

    // Debug mode
    if (this.options.debug) {
      args.push('--debug');
    }

    return args;
  }

  /**
   * Build environment variables
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.env,
    };

    // Set API key if provided
    if (this.options.apiKey) {
      // For Vertex AI mode, use GOOGLE_API_KEY
      // For Google AI Studio, use GEMINI_API_KEY
      const useVertexAI = this.options.env?.GOOGLE_GENAI_USE_VERTEXAI === 'true';

      this.logger.debug('buildEnv() - API Key prefix:', this.options.apiKey.substring(0, 3));
      this.logger.debug('buildEnv() - GOOGLE_GENAI_USE_VERTEXAI:', this.options.env?.GOOGLE_GENAI_USE_VERTEXAI);
      this.logger.debug('buildEnv() - useVertexAI:', useVertexAI);

      if (useVertexAI) {
        env.GOOGLE_API_KEY = this.options.apiKey;
        this.logger.debug('buildEnv() - Setting GOOGLE_API_KEY for Vertex AI');
      } else {
        env.GEMINI_API_KEY = this.options.apiKey;
        this.logger.debug('buildEnv() - Setting GEMINI_API_KEY for AI Studio');
      }
    }

    this.logger.debug('buildEnv() - Final env has GOOGLE_API_KEY:', !!env.GOOGLE_API_KEY);
    this.logger.debug('buildEnv() - Final env has GEMINI_API_KEY:', !!env.GEMINI_API_KEY);
    this.logger.debug('buildEnv() - Final env GOOGLE_GENAI_USE_VERTEXAI:', env.GOOGLE_GENAI_USE_VERTEXAI);

    return env;
  }

  /**
   * Write a JSON message to stdin
   */
  private writeMessage(message: JsonInputMessage): void {
    if (!this.stdinStream) {
      throw new GeminiSDKError('stdin stream not available');
    }

    const json = JSON.stringify(message);
    this.logger.debug('Writing message to stdin:', json.substring(0, 100));

    const success = this.stdinStream.write(json + '\n', (error) => {
      if (error) {
        this.logger.error('Write error:', error);
      } else {
        this.logger.debug('Write callback: message flushed to stdin');
      }
    });

    this.logger.debug('Write success:', success, 'Stream writable:', this.stdinStream.writable);
  }

  /**
   * Start reading JSONL events from stdout
   */
  private startReadLoop(): void {
    if (!this.readlineInterface) {
      return;
    }

    this.readlineInterface.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      // Skip debug output lines (e.g., [MESSAGE_BUS], [PolicyEngine], etc.)
      if (trimmed.startsWith('[')) {
        return;
      }

      try {
        const event = JSON.parse(trimmed) as JsonStreamEvent;
        this.handleEvent(event);
      } catch (error) {
        this.logger.error('Failed to parse JSON:', trimmed);
        this.logger.error('Error:', error);
      }
    });

    this.readlineInterface.on('close', () => {
      // stdout closed - no need to log
    });
  }

  /**
   * Handle a JSON stream event
   */
  private handleEvent(event: JsonStreamEvent): void {
    // Capture INIT event
    if (event.type === JsonStreamEventType.INIT) {
      this.initEvent = event as InitEvent;

      // Clear init timeout
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }

      this.emit('ready', this.initEvent);
    }

    // Emit event to listeners
    this.emit('event', event);
  }

  /**
   * Wait for INIT event
   */
  private async waitForInit(): Promise<void> {
    const timeout = this.options.initTimeout || 30000;

    return new Promise((resolve, reject) => {
      // Already initialized?
      if (this.initEvent) {
        resolve();
        return;
      }

      // Set timeout
      this.initTimeout = setTimeout(() => {
        reject(new GeminiSDKError('Initialization timeout', undefined, { timeout }));
      }, timeout);

      // Wait for ready event
      this.once('ready', () => {
        resolve();
      });

      // Or error
      this.once('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.logger.debug('Process exited:', { code, signal });

    if (code !== 0 && code !== null) {
      this.status = ProcessStatus.ERROR;
      this.emit('error', new GeminiSDKError(`Process exited with code ${code}`, code));
    } else {
      this.status = ProcessStatus.COMPLETED;
    }

    this.emit('stopped', code);

    // Cleanup
    this.process = null;
    this.stdinStream = null;
    if (this.readlineInterface) {
      this.readlineInterface.close();
      this.readlineInterface = null;
    }
  }

  /**
   * Handle process error
   */
  private handleProcessError(error: Error): void {
    this.logger.error('Process error:', error);
    this.status = ProcessStatus.ERROR;
    this.emit('error', error);
  }
}
