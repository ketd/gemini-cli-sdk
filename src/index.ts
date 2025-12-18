/**
 * @google/gemini-cli-sdk
 *
 * TypeScript SDK for Google Gemini CLI
 * Spawn and interact with Gemini CLI as a subprocess
 *
 * @example
 * ```typescript
 * import { query, GeminiClient } from '@google/gemini-cli-sdk';
 *
 * // Low-level API: Stream events
 * const stream = query('Hello, Gemini!', {
 *   pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
 *   apiKey: process.env.GOOGLE_API_KEY,
 * });
 *
 * for await (const event of stream) {
 *   console.log(event);
 * }
 *
 * // High-level API: Client
 * const client = new GeminiClient({
 *   pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
 *   apiKey: process.env.GOOGLE_API_KEY,
 * });
 *
 * const result = await client.query('Explain TypeScript');
 * console.log(result.response);
 * ```
 */

// Core functions
export { query } from './query';

// Clients
export { GeminiClient } from './client';
export { GeminiStreamClient } from './streamClient';

// Types
export type {
  GeminiOptions,
  GeminiStreamOptions,
  JsonStreamEvent,
  JsonInputMessage,
  UserInputMessage,
  ControlInputMessage,
  InitEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  ThoughtEvent,
  ErrorEvent,
  ResultEvent,
  StreamStats,
  QueryResult,
  ToolPermissionRequest,
  ToolPermissionDecision,
  MCPServerConfig,
  MCPServersConfig,
  HooksConfiguration,
} from './types';

export { JsonStreamEventType, JsonInputMessageType, ExitCode, ProcessStatus, GeminiSDKError } from './types';

// Utilities
export { findGeminiCLI, validateApiKey, getApiKey, validateModel, formatDuration, formatTokens } from './utils';
