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
import * as os from 'node:os';
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

  constructor(private options: GeminiStreamOptions) {
    super();

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

    // Create temporary settings.json if hooks are configured
    if (this.options.hooks) {
      await this.createTempSettings();
    }

    // Build command arguments
    const args = this.buildCommand();

    // Build environment variables
    const env = this.buildEnv();

    // Spawn process
    this.process = spawn('node', args, {
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
        // Only log in debug mode, but always consume stderr
        if (this.options.debug) {
          console.error('[GeminiStreamClient] stderr:', chunk.toString());
        }
      });
    }

    this.emit('started');

    // Wait for INIT event
    await this.waitForInit();
  }

  /**
   * Send a user message to the CLI
   */
  async sendMessage(content: string): Promise<void> {
    if (!this.isReady()) {
      throw new GeminiSDKError('Client not ready. Call start() first.');
    }

    const message: JsonInputMessage = {
      type: JsonInputMessageType.USER,
      content,
      session_id: this.options.sessionId,
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
        if (this.options.debug) {
          console.log('[GeminiStreamClient] Cleaned up temp settings:', this.tempSettingsPath);
        }
      } catch (error) {
        console.error('[GeminiStreamClient] Failed to clean up temp settings:', error);
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
   * Create temporary settings.json for hooks configuration
   */
  private async createTempSettings(): Promise<void> {
    const tempDir = os.tmpdir();
    this.tempSettingsPath = path.join(tempDir, `gemini-settings-${this.options.sessionId}.json`);

    const settings = {
      tools: {
        enableHooks: true,
      },
      hooks: this.options.hooks,
    };

    try {
      fs.writeFileSync(this.tempSettingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      if (this.options.debug) {
        console.log('[GeminiStreamClient] Created temp settings:', this.tempSettingsPath);
        console.log('[GeminiStreamClient] Settings content:', JSON.stringify(settings, null, 2));
      }
    } catch (error) {
      throw new GeminiSDKError(`Failed to create temp settings file: ${error}`);
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

    // Settings file (for hooks configuration)
    if (this.tempSettingsPath) {
      args.push('--settings-file', this.tempSettingsPath);
    }

    // Resume from previous session file
    if (this.options.resumeSessionFilePath) {
      args.push('--resume-from-file', this.options.resumeSessionFilePath);
      if (this.options.debug) {
        console.log('[GeminiStreamClient] Resuming from session file:', this.options.resumeSessionFilePath);
      }
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

      if (this.options.debug) {
        console.log('[GeminiStreamClient] buildEnv() - API Key prefix:', this.options.apiKey.substring(0, 3));
        console.log('[GeminiStreamClient] buildEnv() - GOOGLE_GENAI_USE_VERTEXAI:', this.options.env?.GOOGLE_GENAI_USE_VERTEXAI);
        console.log('[GeminiStreamClient] buildEnv() - useVertexAI:', useVertexAI);
      }

      if (useVertexAI) {
        env.GOOGLE_API_KEY = this.options.apiKey;
        if (this.options.debug) {
          console.log('[GeminiStreamClient] buildEnv() - Setting GOOGLE_API_KEY for Vertex AI');
        }
      } else {
        env.GEMINI_API_KEY = this.options.apiKey;
        if (this.options.debug) {
          console.log('[GeminiStreamClient] buildEnv() - Setting GEMINI_API_KEY for AI Studio');
        }
      }
    }

    if (this.options.debug) {
      console.log('[GeminiStreamClient] buildEnv() - Final env has GOOGLE_API_KEY:', !!env.GOOGLE_API_KEY);
      console.log('[GeminiStreamClient] buildEnv() - Final env has GEMINI_API_KEY:', !!env.GEMINI_API_KEY);
      console.log('[GeminiStreamClient] buildEnv() - Final env GOOGLE_GENAI_USE_VERTEXAI:', env.GOOGLE_GENAI_USE_VERTEXAI);
    }

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
    if (this.options.debug) {
      console.log('[GeminiStreamClient] Writing message to stdin:', json.substring(0, 100));
    }

    const success = this.stdinStream.write(json + '\n', (error) => {
      if (error) {
        console.error('[GeminiStreamClient] Write error:', error);
      } else if (this.options.debug) {
        console.log('[GeminiStreamClient] Write callback: message flushed to stdin');
      }
    });

    if (this.options.debug) {
      console.log('[GeminiStreamClient] Write success:', success, 'Stream writable:', this.stdinStream.writable);
    }
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
        if (this.options.debug) {
          console.log('[GeminiStreamClient] Skipping debug output:', trimmed.substring(0, 100));
        }
        return;
      }

      try {
        const event = JSON.parse(trimmed) as JsonStreamEvent;
        this.handleEvent(event);
      } catch (error) {
        console.error('[GeminiStreamClient] Failed to parse JSON:', trimmed);
        console.error('[GeminiStreamClient] Error:', error);
      }
    });

    this.readlineInterface.on('close', () => {
      // stdout closed
      if (this.options.debug) {
        console.log('[GeminiStreamClient] readline interface closed');
      }
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
    if (this.options.debug) {
      console.log('[GeminiStreamClient] Process exited:', { code, signal });
    }

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
    console.error('[GeminiStreamClient] Process error:', error);
    this.status = ProcessStatus.ERROR;
    this.emit('error', error);
  }
}
