/**
 * Utility functions for Gemini CLI SDK
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * Find Gemini CLI executable path
 *
 * Searches in common locations:
 * 1. node_modules/@google/gemini-cli/bundle/gemini.js
 * 2. Custom path from environment variable
 * 3. Global installation
 *
 * @param cwd - Current working directory
 * @returns string - Path to Gemini CLI executable
 * @throws Error if Gemini CLI is not found
 */
export function findGeminiCLI(cwd: string = process.cwd()): string {
  // 1. Check environment variable
  if (process.env.GEMINI_CLI_PATH) {
    const envPath = process.env.GEMINI_CLI_PATH;
    if (fs.existsSync(envPath)) {
      return envPath;
    }
  }

  // 2. Check local node_modules
  const localPath = path.join(cwd, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 3. Check parent directories (monorepo support)
  let currentDir = cwd;
  for (let i = 0; i < 5; i++) {
    const parentPath = path.join(
      currentDir,
      'node_modules',
      '@google',
      'gemini-cli',
      'bundle',
      'gemini.js',
    );
    if (fs.existsSync(parentPath)) {
      return parentPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached root
    currentDir = parentDir;
  }

  throw new Error(
    'Gemini CLI not found. Please install @google/gemini-cli or set GEMINI_CLI_PATH environment variable.',
  );
}

/**
 * Validate API key
 *
 * @param apiKey - API key to validate
 * @returns boolean - True if valid
 */
export function validateApiKey(apiKey?: string): boolean {
  if (!apiKey) {
    const envKey = process.env.GOOGLE_API_KEY;
    return !!envKey && envKey.length > 0;
  }
  return apiKey.length > 0;
}

/**
 * Get API key from environment or options
 *
 * @param apiKey - Optional API key from options
 * @returns string - API key
 * @throws Error if API key is not found
 */
export function getApiKey(apiKey?: string): string {
  const key = apiKey || process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      'API key not found. Please provide apiKey option or set GOOGLE_API_KEY environment variable.',
    );
  }
  return key;
}

/**
 * Parse model name and validate
 *
 * @param model - Model name
 * @returns string - Validated model name
 */
export function validateModel(model?: string): string {
  const defaultModel = 'gemini-2.0-flash-exp';
  if (!model) {
    return defaultModel;
  }

  // Basic validation: should start with 'gemini-'
  if (!model.startsWith('gemini-')) {
    console.warn(`Warning: Model name "${model}" does not start with "gemini-"`);
  }

  return model;
}

/**
 * Format duration in milliseconds to human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns string - Formatted duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format token count with commas
 *
 * @param tokens - Token count
 * @returns string - Formatted token count
 */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}
