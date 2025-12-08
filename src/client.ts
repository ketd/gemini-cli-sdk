/**
 * Gemini CLI Client
 *
 * High-level client for interacting with Gemini CLI
 */

import { EventEmitter } from 'events';
import { query } from './query';
import type {
  GeminiOptions,
  JsonStreamEvent,
  QueryResult,
  ToolResultEvent,
} from './types';
import { JsonStreamEventType, ProcessStatus } from './types';

/**
 * Gemini CLI Client
 *
 * Provides a high-level API for interacting with Gemini CLI
 *
 * @example
 * ```typescript
 * import { GeminiClient } from '@google/gemini-cli-sdk';
 *
 * const client = new GeminiClient({
 *   pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
 *   apiKey: process.env.GOOGLE_API_KEY,
 *   model: 'gemini-2.0-flash-exp',
 * });
 *
 * // Stream events
 * for await (const event of client.stream('Hello, Gemini!')) {
 *   if (event.type === 'message' && event.role === 'assistant' && event.delta) {
 *     process.stdout.write(event.content);
 *   }
 * }
 *
 * // Or get complete result
 * const result = await client.query('Explain TypeScript generics');
 * console.log(result.response);
 * ```
 */
export class GeminiClient extends EventEmitter {
  private status: ProcessStatus = ProcessStatus.IDLE;
  private currentSessionId: string | null = null;

  constructor(private options: GeminiOptions) {
    super();
  }

  /**
   * Stream events from Gemini CLI
   *
   * @param prompt - User prompt
   * @returns AsyncGenerator<JsonStreamEvent> - Stream of JSON events
   */
  async *stream(prompt: string): AsyncGenerator<JsonStreamEvent> {
    this.status = ProcessStatus.RUNNING;
    this.emit('status', this.status);

    try {
      for await (const event of query(prompt, this.options)) {
        // Track session ID
        if (event.type === JsonStreamEventType.INIT) {
          this.currentSessionId = event.session_id;
          this.emit('session', event.session_id);
        }

        // Emit event
        this.emit('event', event);

        // Yield to caller
        yield event;

        // Handle final result
        if (event.type === JsonStreamEventType.RESULT) {
          this.status =
            event.status === 'success' ? ProcessStatus.COMPLETED : ProcessStatus.ERROR;
          this.emit('status', this.status);
        }
      }
    } catch (error) {
      this.status = ProcessStatus.ERROR;
      this.emit('status', this.status);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Query Gemini CLI and return complete result
   *
   * @param prompt - User prompt
   * @returns Promise<QueryResult> - Complete query result
   */
  async query(prompt: string): Promise<QueryResult> {
    const result: QueryResult = {
      sessionId: '',
      model: '',
      response: '',
      toolCalls: [],
      status: 'success',
    };

    const toolCallsMap = new Map<
      string,
      {
        tool_name: string;
        tool_id: string;
        parameters: Record<string, unknown>;
        result?: ToolResultEvent;
      }
    >();

    for await (const event of this.stream(prompt)) {
      switch (event.type) {
        case JsonStreamEventType.INIT:
          result.sessionId = event.session_id;
          result.model = event.model;
          break;

        case JsonStreamEventType.MESSAGE:
          if (event.role === 'assistant') {
            result.response += event.content;
          }
          break;

        case JsonStreamEventType.TOOL_USE:
          toolCallsMap.set(event.tool_id, {
            tool_name: event.tool_name,
            tool_id: event.tool_id,
            parameters: event.parameters,
          });
          break;

        case JsonStreamEventType.TOOL_RESULT:
          {
            const toolCall = toolCallsMap.get(event.tool_id);
            if (toolCall) {
              toolCall.result = event;
              result.toolCalls.push({
                tool_name: toolCall.tool_name,
                tool_id: toolCall.tool_id,
                parameters: toolCall.parameters,
                result: {
                  status: event.status,
                  output: event.output,
                  error: event.error,
                },
              });
            }
          }
          break;

        case JsonStreamEventType.RESULT:
          result.status = event.status;
          result.stats = event.stats;
          if (event.error) {
            result.error = event.error;
          }
          break;

        case JsonStreamEventType.ERROR:
          // Log errors but don't fail the query
          this.emit('warning', event);
          break;
      }
    }

    return result;
  }

  /**
   * Get current process status
   */
  getStatus(): ProcessStatus {
    return this.status;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Update options
   */
  setOptions(options: Partial<GeminiOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): Readonly<GeminiOptions> {
    return { ...this.options };
  }
}
