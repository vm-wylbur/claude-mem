#!/usr/bin/env tsx
// TDD Phase 1: Error Response Utility Tests  
// Author: PB and Claude
// Date: 2025-07-04
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// Error Response Utility Unit Tests (TDD Implementation)

import { createErrorResponse, MCPErrorResponse } from '../src/utils/error-response.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class ErrorResponseTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Error Response Utility Unit Tests (TDD)');
    console.error('============================================\n');

    // Run all tests
    this.testErrorObjectHandling();
    this.testStringErrorHandling();
    this.testUnknownErrorTypes();
    this.testNullUndefinedErrors();
    this.testContextInclusion();
    this.testMCPResponseFormat();
    this.testLongErrorMessages();
    this.testSpecialCharacters();
    this.testConsistency();

    this.printResults();
  }

  private testErrorObjectHandling(): void {
    try {
      const error = new Error('Test error message');
      const result = createErrorResponse(error, 'test-context');
      
      if (!result.isError) {
        throw new Error('isError should be true');
      }
      
      if (result.content.length !== 1) {
        throw new Error(`Expected 1 content item, got ${result.content.length}`);
      }
      
      if (result.content[0].type !== 'text') {
        throw new Error(`Expected type 'text', got '${result.content[0].type}'`);
      }
      
      if (!result.content[0].text.includes('Test error message')) {
        throw new Error('Error message not included in response');
      }
      
      if (!result.content[0].text.includes('test-context')) {
        throw new Error('Context not included in response');
      }
      
      this.results.push({ name: 'Error Object Handling', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Error Object Handling', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testStringErrorHandling(): void {
    try {
      const error = 'String error message';
      const result = createErrorResponse(error, 'string-context');
      
      if (!result.isError) {
        throw new Error('isError should be true');
      }
      
      if (!result.content[0].text.includes('String error message')) {
        throw new Error('String error message not included');
      }
      
      if (!result.content[0].text.includes('string-context')) {
        throw new Error('Context not included in response');
      }
      
      this.results.push({ name: 'String Error Handling', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'String Error Handling', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testUnknownErrorTypes(): void {
    try {
      const error = { unknown: 'object', nested: { data: 'test' } };
      const result = createErrorResponse(error, 'object-context');
      
      if (!result.isError) {
        throw new Error('isError should be true');
      }
      
      if (!result.content[0].text.includes('[object Object]')) {
        throw new Error('Object error not properly stringified');
      }
      
      if (!result.content[0].text.includes('object-context')) {
        throw new Error('Context not included in response');
      }
      
      this.results.push({ name: 'Unknown Error Types', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Unknown Error Types', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testNullUndefinedErrors(): void {
    try {
      const nullResult = createErrorResponse(null, 'null-context');
      const undefinedResult = createErrorResponse(undefined, 'undefined-context');
      
      if (!nullResult.isError || !undefinedResult.isError) {
        throw new Error('Both null and undefined should result in error responses');
      }
      
      if (!nullResult.content[0].text.includes('null')) {
        throw new Error('Null error not handled correctly');
      }
      
      if (!undefinedResult.content[0].text.includes('undefined')) {
        throw new Error('Undefined error not handled correctly');
      }
      
      this.results.push({ name: 'Null/Undefined Error Handling', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Null/Undefined Error Handling', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testContextInclusion(): void {
    try {
      const error = new Error('Test');
      const result = createErrorResponse(error, 'memory-storage');
      
      if (!result.content[0].text.includes('memory-storage')) {
        throw new Error('Context not included in error message');
      }
      
      // Check format: should contain both context and error message
      const text = result.content[0].text;
      if (!text.match(/Error.*memory-storage.*Test/)) {
        throw new Error('Error message format incorrect');
      }
      
      this.results.push({ name: 'Context Inclusion', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Context Inclusion', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testMCPResponseFormat(): void {
    try {
      const error = new Error('Test error');
      const result = createErrorResponse(error, 'test');
      
      // Check interface compliance
      if (typeof result.isError !== 'boolean' || result.isError !== true) {
        throw new Error('isError property incorrect');
      }
      
      if (!Array.isArray(result.content)) {
        throw new Error('content should be an array');
      }
      
      if (result.content[0].type !== 'text') {
        throw new Error('content type should be text');
      }
      
      if (typeof result.content[0].text !== 'string') {
        throw new Error('content text should be string');
      }
      
      this.results.push({ name: 'MCP Response Format', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'MCP Response Format', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testLongErrorMessages(): void {
    try {
      const longMessage = 'A'.repeat(10000);
      const error = new Error(longMessage);
      const result = createErrorResponse(error, 'long-message-test');
      
      if (!result.isError) {
        throw new Error('Should handle long messages as errors');
      }
      
      if (result.content[0].text.length <= 10000) {
        throw new Error('Long message not preserved');
      }
      
      if (!result.content[0].text.includes('long-message-test')) {
        throw new Error('Context not included with long message');
      }
      
      this.results.push({ name: 'Long Error Messages', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Long Error Messages', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testSpecialCharacters(): void {
    try {
      const error = new Error('Test error');
      const specialContext = 'context-with-special-chars-!@#$%^&*()';
      const result = createErrorResponse(error, specialContext);
      
      if (!result.content[0].text.includes(specialContext)) {
        throw new Error('Special characters in context not preserved');
      }
      
      this.results.push({ name: 'Special Characters', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Special Characters', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testConsistency(): void {
    try {
      const error = new Error('Consistent test');
      const context = 'consistency-test';
      
      const result1 = createErrorResponse(error, context);
      const result2 = createErrorResponse(error, context);
      
      if (result1.content[0].text !== result2.content[0].text) {
        throw new Error('Results should be consistent across calls');
      }
      
      if (result1.isError !== result2.isError) {
        throw new Error('isError should be consistent');
      }
      
      this.results.push({ name: 'Consistency', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Consistency', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private printResults(): void {
    console.error('\n📊 Test Results:');
    console.error('================');
    
    let passedCount = 0;
    
    for (const result of this.results) {
      if (result.passed) {
        console.error(`✅ ${result.name}`);
        passedCount++;
      } else {
        console.error(`❌ ${result.name}`);
        console.error(`   Error: ${result.error}`);
      }
    }
    
    console.error(`\n📈 Summary: ${passedCount}/${this.results.length} tests passed`);
    
    if (passedCount === this.results.length) {
      console.error('🎉 All error response utility tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some error response utility tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new ErrorResponseTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Error response utility tests failed to run:', error);
  process.exit(1);
});