/**
 * Logger utility for Gemini CLI SDK
 *
 * Provides a configurable logging interface that can be customized by SDK consumers.
 * By default, logs go to console. Users can provide their own logger implementation.
 */

/**
 * Log level enumeration
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Logger interface that SDK consumers can implement
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Custom logger implementation */
  logger?: Logger;
  /** Minimum log level to output (default: INFO, or DEBUG if debug=true) */
  level?: LogLevel;
  /** Prefix for all log messages (e.g., '[GeminiSDK]') */
  prefix?: string;
}

/**
 * Default console logger implementation
 */
const consoleLogger: Logger = {
  debug: (message: string, ...args: unknown[]) => console.log(message, ...args),
  info: (message: string, ...args: unknown[]) => console.log(message, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(message, ...args),
  error: (message: string, ...args: unknown[]) => console.error(message, ...args),
};

/**
 * Silent logger that outputs nothing
 */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * SDK Logger class
 *
 * Wraps a logger implementation with level filtering and prefix support.
 *
 * @example
 * ```typescript
 * // Use default console logger
 * const logger = new SDKLogger({ level: LogLevel.DEBUG });
 *
 * // Use custom logger
 * const logger = new SDKLogger({
 *   logger: myCustomLogger,
 *   prefix: '[MyApp]',
 * });
 *
 * logger.debug('Debug message');
 * logger.error('Error occurred', { details: '...' });
 * ```
 */
export class SDKLogger implements Logger {
  private logger: Logger;
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.logger = options.logger || consoleLogger;
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix || '';
  }

  /**
   * Update logger configuration
   */
  configure(options: Partial<LoggerOptions>): void {
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }
    if (options.level !== undefined) {
      this.level = options.level;
    }
    if (options.prefix !== undefined) {
      this.prefix = options.prefix;
    }
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Set custom logger implementation
   */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  private formatMessage(message: string): string {
    return this.prefix ? `${this.prefix} ${message}` : message;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      this.logger.debug(this.formatMessage(message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      this.logger.info(this.formatMessage(message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      this.logger.warn(this.formatMessage(message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      this.logger.error(this.formatMessage(message), ...args);
    }
  }
}

/**
 * Global SDK logger instance
 *
 * Used internally by SDK components. Can be configured by SDK consumers.
 *
 * @example
 * ```typescript
 * import { sdkLogger, LogLevel } from '@google/gemini-cli-sdk';
 *
 * // Configure global logger
 * sdkLogger.setLevel(LogLevel.DEBUG);
 * sdkLogger.setLogger(myCustomLogger);
 * ```
 */
export const sdkLogger = new SDKLogger({
  prefix: '[GeminiSDK]',
  level: LogLevel.INFO,
});

/**
 * Create a component-specific logger
 *
 * @param component - Component name for the prefix (e.g., 'GeminiStreamClient')
 * @param options - Logger options
 */
export function createLogger(component: string, options: LoggerOptions = {}): SDKLogger {
  return new SDKLogger({
    ...options,
    prefix: options.prefix || `[${component}]`,
  });
}
