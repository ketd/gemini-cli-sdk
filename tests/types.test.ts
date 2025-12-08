/**
 * Tests for type definitions
 */

import { describe, it, expect } from 'vitest';
import { JsonStreamEventType, ExitCode, ProcessStatus, GeminiSDKError } from '../src/types';

describe('JsonStreamEventType', () => {
  it('should have correct event types', () => {
    expect(JsonStreamEventType.INIT).toBe('init');
    expect(JsonStreamEventType.MESSAGE).toBe('message');
    expect(JsonStreamEventType.TOOL_USE).toBe('tool_use');
    expect(JsonStreamEventType.TOOL_RESULT).toBe('tool_result');
    expect(JsonStreamEventType.ERROR).toBe('error');
    expect(JsonStreamEventType.RESULT).toBe('result');
  });
});

describe('ExitCode', () => {
  it('should have correct exit codes', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.CONFIG_ERROR).toBe(2);
    expect(ExitCode.USER_INTERRUPTED).toBe(130);
  });
});

describe('ProcessStatus', () => {
  it('should have correct status values', () => {
    expect(ProcessStatus.IDLE).toBe('idle');
    expect(ProcessStatus.RUNNING).toBe('running');
    expect(ProcessStatus.COMPLETED).toBe('completed');
    expect(ProcessStatus.CANCELLED).toBe('cancelled');
    expect(ProcessStatus.ERROR).toBe('error');
  });
});

describe('GeminiSDKError', () => {
  it('should create error with message', () => {
    const error = new GeminiSDKError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('GeminiSDKError');
  });

  it('should create error with code', () => {
    const error = new GeminiSDKError('Test error', ExitCode.CONFIG_ERROR);
    expect(error.code).toBe(ExitCode.CONFIG_ERROR);
  });

  it('should create error with details', () => {
    const details = { foo: 'bar' };
    const error = new GeminiSDKError('Test error', undefined, details);
    expect(error.details).toEqual(details);
  });
});
