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

  /**
   * Permission callback for tool execution
   * Called when a tool requires approval (when approvalMode is 'default')
   * Return true to approve, false to deny
   * If not provided, falls back to Gemini CLI's built-in approval mechanism
   */
  onPermissionRequest?: (request: ToolPermissionRequest) => Promise<ToolPermissionDecision>;
}

/**
 * Tool permission request
 */
export interface ToolPermissionRequest {
  /** Unique tool call ID */
  toolId: string;

  /** Tool name (e.g., 'write_file', 'run_shell_command') */
  toolName: string;

  /** Tool parameters */
  parameters: Record<string, unknown>;

  /** Timestamp of the request */
  timestamp: string;
}

/**
 * Tool permission decision from host application
 */
export interface ToolPermissionDecision {
  /** Whether to approve the tool execution */
  approved: boolean;

  /** Optional reason for the decision (for logging) */
  reason?: string;
}

/**
 * JSON Stream Event Types
 *
 * Based on: @google/gemini-cli/packages/core/src/output/types.ts
 * Plus additional event types actually sent by CLI
 */
export enum JsonStreamEventType {
  /** Session initialization */
  INIT = 'init',

  /** Message content (user/assistant) */
  MESSAGE = 'message',

  /** Tool call request (legacy) */
  TOOL_USE = 'tool_use',

  /** Tool call request (new format) */
  TOOL_CALL_REQUEST = 'tool_call_request',

  /** Tool execution result */
  TOOL_RESULT = 'tool_result',

  /** Thought/reasoning process */
  THOUGHT = 'thought',

  /** Error event */
  ERROR = 'error',

  /** Final result */
  RESULT = 'result',

  // Additional event types actually sent by Gemini CLI
  /** Message content chunk (streaming) */
  CONTENT = 'content',

  /** Message completion with metadata */
  FINISHED = 'finished',

  /** Model information */
  MODEL_INFO = 'model_info',
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
 * Tool call event (legacy format)
 */
export interface ToolUseEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.TOOL_USE;
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
}

/**
 * Tool call request event (new format)
 */
export interface ToolCallRequestEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.TOOL_CALL_REQUEST;
  value: {
    callId: string;
    name: string;
    args: Record<string, unknown>;
    isClientInitiated: boolean;
    prompt_id: string;
  };
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
 * Thought summary containing subject and description
 */
export interface ThoughtSummary {
  subject: string;
  description?: string;
}

/**
 * Thought/reasoning event
 * Emitted by Gemini CLI when the model is thinking
 */
export interface ThoughtEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.THOUGHT;
  subject: string;
  description?: string;
  traceId?: string;
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
 * Content event (streaming message chunk)
 * This is the actual event type sent by Gemini CLI for message content
 */
export interface ContentEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.CONTENT;
  value: string;
  traceId?: string;
}

/**
 * Finished event (message completion with metadata)
 */
export interface FinishedEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.FINISHED;
  value: {
    reason: string;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      trafficType?: string;
      promptTokensDetails?: Array<{
        modality: string;
        tokenCount: number;
      }>;
      candidatesTokensDetails?: Array<{
        modality: string;
        tokenCount: number;
      }>;
      thoughtsTokenCount?: number;
    };
  };
}

/**
 * Model information event
 */
export interface ModelInfoEvent extends BaseJsonStreamEvent {
  type: JsonStreamEventType.MODEL_INFO;
  value: string;
}

/**
 * Union type of all JSON stream events
 */
export type JsonStreamEvent =
  | InitEvent
  | MessageEvent
  | ToolUseEvent
  | ToolCallRequestEvent
  | ToolResultEvent
  | ThoughtEvent
  | ErrorEvent
  | ResultEvent
  | ContentEvent
  | FinishedEvent
  | ModelInfoEvent;

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
    // captureStackTrace is available in V8 (Node.js) but not in all environments
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, GeminiSDKError);
    }
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

/**
 * Input message types for Stream Client (SDK → CLI via stdin)
 */
export enum JsonInputMessageType {
  /** User message */
  USER = 'user',

  /** Control command */
  CONTROL = 'control',
}

/**
 * User message sent to CLI
 */
export interface UserInputMessage {
  type: JsonInputMessageType.USER;
  content: string;
  session_id?: string;
}

/**
 * Control message sent to CLI
 */
export interface ControlInputMessage {
  type: JsonInputMessageType.CONTROL;
  control: {
    subtype: 'interrupt' | 'cancel' | 'shutdown';
  };
  session_id?: string;
}

/**
 * Union type for input messages
 */
export type JsonInputMessage = UserInputMessage | ControlInputMessage;

/**
 * Hook configuration types (from Gemini CLI)
 */
export interface HookConfig {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface HookDefinition {
  matcher?: string;
  sequential?: boolean;
  hooks: HookConfig[];
}

export interface HooksConfiguration {
  BeforeTool?: HookDefinition[];
  AfterTool?: HookDefinition[];
  BeforeAgent?: HookDefinition[];
  AfterAgent?: HookDefinition[];
  BeforeModel?: HookDefinition[];
  AfterModel?: HookDefinition[];
  BeforeToolSelection?: HookDefinition[];
  Notification?: HookDefinition[];
  SessionStart?: HookDefinition[];
  SessionEnd?: HookDefinition[];
  PreCompress?: HookDefinition[];
  disabled?: string[];
}

/**
 * Options for GeminiStreamClient
 */
export interface GeminiStreamOptions {
  /**
   * Path to Gemini CLI executable
   * @example 'node_modules/@google/gemini-cli/bundle/gemini.js'
   */
  pathToGeminiCLI: string;

  /**
   * Session ID for this client instance
   * Each client manages one session
   */
  sessionId: string;

  /**
   * Workspace ID (optional, for tracking)
   */
  workspaceId?: string;

  /**
   * Google AI API Key
   * Can also be set via GEMINI_API_KEY environment variable
   */
  apiKey?: string;

  /**
   * Model name
   * @default 'gemini-2.0-flash-exp'
   */
  model?: string;

  /**
   * Working directory for CLI execution
   * @default process.cwd()
   */
  cwd?: string;

  /**
   * Approval mode for tool execution
   * @default 'default'
   */
  approvalMode?: 'default' | 'auto_edit' | 'yolo';

  /**
   * List of tools that are allowed to execute
   * If not specified, all tools are allowed
   * @example ['read_file', 'write_file', 'run_shell_command']
   */
  allowedTools?: string[];

  /**
   * Custom environment variables
   */
  env?: Record<string, string>;

  /**
   * Enable debug mode
   * @default false
   */
  debug?: boolean;

  /**
   * Timeout for process initialization (ms)
   * @default 30000
   */
  initTimeout?: number;

  /**
   * Hooks configuration
   * Passed to Gemini CLI via temporary settings.json
   */
  hooks?: HooksConfiguration;

  /**
   * Resume from a previous session file path
   * If provided, Gemini CLI will load the session history using --resume flag
   * @example '/path/to/session-2025-01-01T12-00-abc123.json'
   */
  resumeSessionFilePath?: string;
}
