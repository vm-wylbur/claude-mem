#!/usr/bin/env tsx
// TDD Phase 1: Error Response Utility Tests
// Author: PB and Claude
// RED phase: These tests will fail until we implement the utility

import { createErrorResponse, MCPErrorResponse } from '../../src/utils/error-response';

describe('createErrorResponse', () => {
  it('should handle Error objects correctly', () => {
    const error = new Error('Test error message');
    const result = createErrorResponse(error, 'test-context');
    
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Test error message');
    expect(result.content[0].text).toContain('test-context');
  });

  it('should handle string errors', () => {
    const error = 'String error message';
    const result = createErrorResponse(error, 'string-context');
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('String error message');
    expect(result.content[0].text).toContain('string-context');
  });

  it('should handle unknown error types', () => {
    const error = { unknown: 'object', nested: { data: 'test' } };
    const result = createErrorResponse(error, 'object-context');
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('[object Object]');
    expect(result.content[0].text).toContain('object-context');
  });

  it('should handle null and undefined errors', () => {
    const nullResult = createErrorResponse(null, 'null-context');
    const undefinedResult = createErrorResponse(undefined, 'undefined-context');
    
    expect(nullResult.isError).toBe(true);
    expect(nullResult.content[0].text).toContain('null');
    
    expect(undefinedResult.isError).toBe(true);
    expect(undefinedResult.content[0].text).toContain('undefined');
  });

  it('should include context in error messages', () => {
    const error = new Error('Test');
    const result = createErrorResponse(error, 'memory-storage');
    
    expect(result.content[0].text).toContain('memory-storage');
    expect(result.content[0].text).toMatch(/Error.*memory-storage.*Test/);
  });

  it('should return proper MCP response format', () => {
    const error = new Error('Test error');
    const result = createErrorResponse(error, 'test');
    
    // Check interface compliance
    expect(result).toHaveProperty('isError', true);
    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
    expect(typeof result.content[0].text).toBe('string');
  });

  it('should handle very long error messages', () => {
    const longMessage = 'A'.repeat(10000);
    const error = new Error(longMessage);
    const result = createErrorResponse(error, 'long-message-test');
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text.length).toBeGreaterThan(10000);
    expect(result.content[0].text).toContain('long-message-test');
  });

  it('should handle special characters in context', () => {
    const error = new Error('Test error');
    const specialContext = 'context-with-special-chars-!@#$%^&*()';
    const result = createErrorResponse(error, specialContext);
    
    expect(result.content[0].text).toContain(specialContext);
  });

  it('should be consistent across multiple calls', () => {
    const error = new Error('Consistent test');
    const context = 'consistency-test';
    
    const result1 = createErrorResponse(error, context);
    const result2 = createErrorResponse(error, context);
    
    expect(result1.content[0].text).toBe(result2.content[0].text);
    expect(result1.isError).toBe(result2.isError);
  });

  describe('MCPErrorResponse type checking', () => {
    it('should conform to MCPErrorResponse interface', () => {
      const error = new Error('Type test');
      const result: MCPErrorResponse = createErrorResponse(error, 'type-test');
      
      // TypeScript compilation will fail if interface doesn't match
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
    });
  });
});