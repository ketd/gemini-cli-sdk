/**
 * Type definitions for Gemini CLI SDK
 *
 * Based on Gemini CLI v0.21.0+ interface specification
 */

/**
 * Gemini CLI configuration options
 */
export interface GeminiOptions {
  /**
   * Path to Gemini CLI executable
   * @example 'node_modules/@google/gemini-cli/bundle/gemini.js'
   */
  pathToGeminiCLI: string;

  /**
   * Google AI API Key
   * Can also be set via GEMINI_API_KEY environment variable
   */
  apiKey?: string;

  /**
   * Model name
   * @default 'gemini-2.0-flash-exp'
   * @example 'gemini-2.0-flash-exp', 'gemini-1.5-pro'
   */
  model?: string;

  /**
   * Working directory for CLI execution
   * @default process.cwd()
   */
  cwd?: string;

  /**
   * System prompt (not directly supported by CLI, needs workaround)
   */
  systemPrompt?: string;

  /**
   * Approval mode for tool execution
   * - default: Prompt for approval
   * - auto_edit: Auto-approve edit tools
   * - yolo: Auto-approve all tools
   * @default 'default'
   */
  approvalMode?: 'default' | 'auto_edit' | 'yolo';

  /**
   * List of tools that can run without confirmation
   * @example ['read', 'write', 'bash']
   */
  allowedTools?: string[];

  /**
   * List of allowed MCP server names
   */
  allowedMcpServerNames?: string[];

  /**
   * Enable debug mode
   * @default false
   */
  debug?: boolean;

  /**
   * Session ID to resume
   * Use 'latest' to resume the most recent session
   */
  resumeSessionId?: string;

  /**
   * Enable sandbox mode
   * @default false
   */
  sandbox?: boolean;

  /**
   * Additional directories to include in workspace
   */
  includeDirectories?: string[];

  /**
   * Custom environment variables
   */
  env?: Record<string, string>;

  /**
   * Timeout in milliseconds
   * @default undefined (no timeout)
   */
  timeout?: number;
}

/**
 * JSON Stream Event Types
 *
 * Based on: @google/gemini-cli/packages/core/src/output/types.ts
 */
export enum JsonStreamEventType {
  /** Session initialization */
  INIT = 'init',

  /** Message content (user/assistant) */
  MESSAGE = 'message',

  /** Tool call request */
  TOOL_USE = 'tool_use',

  /** Tool execution result */
  TOOL_RESULT = 'tool_result',

  /** Error event */
  ERROR = 'error',

  /** Final result */
  RESULT = 'result',
}

/**
 * Base event interface
 */
export interface BaseJsonStreamEvent {
  type: JsonStreamEventType;
  timestamp: string; // ISO 8601 format
}

/**
 * Session initialization event
 */
export interface InitEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.INIT;
  session_id: string;
  model: string;
  conversation_file_path?: string; // Added for AoE Desktop integration
}

/**
 * Message event
 */
export interface MessageEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.MESSAGE;
  role: 'user' | 'assistant';
  content: string;
  delta?: boolean; // true for incremental content
}

/**
 * Tool call event
 */
export interface ToolUseEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.TOOL_USE;
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
}

/**
 * Tool execution result event
 */
export interface ToolResultEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.TOOL_RESULT;
  tool_id: string;
  status: 'success' | 'error';
  output?: string;
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.ERROR;
  severity: 'warning' | 'error';
  message: string;
}

/**
 * Stream statistics
 */
export interface StreamStats {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  tool_calls: number;
}

/**
 * Final result event
 */
export interface ResultEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.RESULT;
  status: 'success' | 'error';
  error?: {
    type: string;
    message: string;
  };
  stats?: StreamStats;
}

/**
 * Union type of all JSON stream events
 */
export type JsonStreamEvent =
  | InitEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | ResultEvent;

/**
 * Gemini CLI exit codes
 */
export enum ExitCode {
  /** Success */
  SUCCESS = 0,

  /** General error */
  GENERAL_ERROR = 1,

  /** Configuration error */
  CONFIG_ERROR = 2,

  /** User interrupted (Ctrl+C) */
  USER_INTERRUPTED = 130,
}

/**
 * CLI process status
 */
export enum ProcessStatus {
  /** Not started */
  IDLE = 'idle',

  /** Running */
  RUNNING = 'running',

  /** Completed successfully */
  COMPLETED = 'completed',

  /** Cancelled by user */
  CANCELLED = 'cancelled',

  /** Error occurred */
  ERROR = 'error',
}

/**
 * Gemini SDK Error
 */
export class GeminiSDKError extends Error {
  constructor(
    message: string,
    public code?: ExitCode,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'GeminiSDKError';
    Error.captureStackTrace(this, GeminiSDKError);
  }
}

/**
 * Query result (accumulated from stream)
 */
export interface QueryResult {
  /** Session ID */
  sessionId: string;

  /** Model used */
  model: string;

  /** Full assistant response text */
  response: string;

  /** Tool calls made during the query */
  toolCalls: Array<{
    tool_name: string;
    tool_id: string;
    parameters: Record<string, unknown>;
    result?: {
      status: 'success' | 'error';
      output?: string;
      error?: { type: string; message: string };
    };
  }>;

  /** Final statistics */
  stats?: StreamStats;

  /** Final status */
  status: 'success' | 'error';

  /** Error if status is 'error' */
  error?: {
    type: string;
    message: string;
  };
}
