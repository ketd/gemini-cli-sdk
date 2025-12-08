/**
 * Core query function for Gemini CLI SDK
 *
 * Spawns Gemini CLI as subprocess and streams JSON events
 */

import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import type { GeminiOptions, JsonStreamEvent } from './types';
import { GeminiSDKError, ExitCode } from './types';

/**
 * Build CLI arguments from options
 */
function buildCliArgs(options: GeminiOptions, prompt: string): string[] {
  const args: string[] = [];

  // Output format: always use stream-json
  args.push('--output-format', 'stream-json');

  // Model
  if (options.model) {
    args.push('--model', options.model);
  }

  // Approval mode
  if (options.approvalMode) {
    args.push('--approval-mode', options.approvalMode);
  }

  // Allowed tools
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--allowed-tools', options.allowedTools.join(','));
  }

  // Allowed MCP servers
  if (options.allowedMcpServerNames && options.allowedMcpServerNames.length > 0) {
    args.push('--allowed-mcp-server-names', options.allowedMcpServerNames.join(','));
  }

  // Resume session
  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  // Sandbox mode
  if (options.sandbox) {
    args.push('--sandbox');
  }

  // Include directories
  if (options.includeDirectories && options.includeDirectories.length > 0) {
    args.push('--include-directories', options.includeDirectories.join(','));
  }

  // Debug mode
  if (options.debug) {
    args.push('--debug');
  }

  // Positional argument: user prompt
  args.push('--', prompt);

  return args;
}

/**
 * Build environment variables
 */
function buildEnv(options: GeminiOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
  };

  // API Key
  if (options.apiKey) {
    env.GOOGLE_API_KEY = options.apiKey;
  }

  // Debug mode
  if (options.debug) {
    env.DEBUG = '1';
  }

  return env;
}

/**
 * Query Gemini CLI and stream JSON events
 *
 * @param prompt - User prompt
 * @param options - Gemini configuration options
 * @returns AsyncGenerator<JsonStreamEvent> - Stream of JSON events
 *
 * @example
 * ```typescript
 * import { query } from '@google/gemini-cli-sdk';
 *
 * const stream = query('Hello, Gemini!', {
 *   pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
 *   apiKey: process.env.GOOGLE_API_KEY,
 *   model: 'gemini-2.0-flash-exp',
 * });
 *
 * for await (const event of stream) {
 *   if (event.type === 'message' && event.role === 'assistant' && event.delta) {
 *     process.stdout.write(event.content);
 *   }
 * }
 * ```
 */
export async function* query(
  prompt: string,
  options: GeminiOptions,
): AsyncGenerator<JsonStreamEvent> {
  // Validate required options
  if (!options.pathToGeminiCLI) {
    throw new GeminiSDKError('pathToGeminiCLI is required');
  }

  if (!options.apiKey && !process.env.GOOGLE_API_KEY) {
    throw new GeminiSDKError(
      'apiKey is required (or set GOOGLE_API_KEY environment variable)',
    );
  }

  // Build CLI arguments and environment
  const args = buildCliArgs(options, prompt);
  const env = buildEnv(options);
  const cwd = options.cwd || process.cwd();

  // Spawn Gemini CLI subprocess
  let geminiProcess: ChildProcess;
  try {
    geminiProcess = spawn('node', [options.pathToGeminiCLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd,
    });
  } catch (error) {
    throw new GeminiSDKError('Failed to spawn Gemini CLI process', undefined, error);
  }

  // Handle stderr (CLI internal logs)
  const stderrChunks: Buffer[] = [];
  geminiProcess.stderr?.on('data', (data: Buffer) => {
    stderrChunks.push(data);
    if (options.debug) {
      console.error('[Gemini CLI stderr]:', data.toString());
    }
  });

  // Setup timeout if specified
  let timeoutId: NodeJS.Timeout | undefined;
  if (options.timeout) {
    timeoutId = setTimeout(() => {
      geminiProcess.kill('SIGTERM');
    }, options.timeout);
  }

  // Create readline interface for stdout
  const rl = readline.createInterface({
    input: geminiProcess.stdout!,
    crlfDelay: Infinity,
  });

  // Track if we've yielded any events
  let hasYieldedEvents = false;

  try {
    // Stream JSON-Lines output
    for await (const line of rl) {
      try {
        const event = JSON.parse(line) as JsonStreamEvent;
        hasYieldedEvents = true;
        yield event;
      } catch (parseError) {
        // Log parse errors but continue processing
        if (options.debug) {
          console.error('[Gemini SDK] Failed to parse JSON line:', line);
          console.error('[Gemini SDK] Parse error:', parseError);
        }
      }
    }
  } catch (error) {
    throw new GeminiSDKError('Failed to read from Gemini CLI stdout', undefined, error);
  } finally {
    // Clear timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  // Wait for process to exit
  const exitCode = await new Promise<number>((resolve, reject) => {
    geminiProcess.on('exit', (code, signal) => {
      if (signal) {
        reject(
          new GeminiSDKError(
            `Gemini CLI process was killed with signal ${signal}`,
            ExitCode.USER_INTERRUPTED,
          ),
        );
      } else {
        resolve(code ?? ExitCode.GENERAL_ERROR);
      }
    });

    geminiProcess.on('error', (error) => {
      reject(new GeminiSDKError('Gemini CLI process error', undefined, error));
    });
  });

  // Handle exit code
  if (exitCode !== ExitCode.SUCCESS) {
    const stderrOutput = Buffer.concat(stderrChunks).toString();
    throw new GeminiSDKError(
      `Gemini CLI exited with code ${exitCode}${stderrOutput ? `\n${stderrOutput}` : ''}`,
      exitCode as ExitCode,
      { stderr: stderrOutput },
    );
  }

  // If no events were yielded, something went wrong
  if (!hasYieldedEvents) {
    const stderrOutput = Buffer.concat(stderrChunks).toString();
    throw new GeminiSDKError(
      'No events received from Gemini CLI',
      undefined,
      { stderr: stderrOutput },
    );
  }
}
