/**
 * Tests for utility functions
 */

import { describe, it, expect, afterEach } from 'vitest';
import { validateApiKey, validateModel, formatDuration, formatTokens } from '../src/utils';

describe('validateApiKey', () => {
  const originalEnv = process.env.GOOGLE_API_KEY;

  afterEach(() => {
    // Restore original env
    if (originalEnv) {
      process.env.GOOGLE_API_KEY = originalEnv;
    } else {
      delete process.env.GOOGLE_API_KEY;
    }
  });

  it('should return true for valid API key', () => {
    expect(validateApiKey('valid-key')).toBe(true);
  });

  it('should return false for empty API key', () => {
    delete process.env.GOOGLE_API_KEY;
    expect(validateApiKey('')).toBe(false);
  });

  it('should return false for undefined API key when no env var', () => {
    delete process.env.GOOGLE_API_KEY;
    expect(validateApiKey(undefined)).toBe(false);
  });

  it('should return true when env var is set', () => {
    process.env.GOOGLE_API_KEY = 'env-key';
    expect(validateApiKey(undefined)).toBe(true);
  });
});

describe('validateModel', () => {
  it('should return default model when no model provided', () => {
    expect(validateModel()).toBe('gemini-2.0-flash-exp');
  });

  it('should return provided model', () => {
    expect(validateModel('gemini-1.5-pro')).toBe('gemini-1.5-pro');
  });

  it('should accept custom model names', () => {
    expect(validateModel('custom-model')).toBe('custom-model');
  });
});

describe('formatDuration', () => {
  it('should format milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('should format seconds', () => {
    expect(formatDuration(5432)).toBe('5.43s');
  });

  it('should format minutes', () => {
    expect(formatDuration(125000)).toBe('2m 5s');
  });
});

describe('formatTokens', () => {
  it('should format token count with commas', () => {
    expect(formatTokens(1234567)).toBe('1,234,567');
  });

  it('should handle small numbers', () => {
    expect(formatTokens(123)).toBe('123');
  });
});
