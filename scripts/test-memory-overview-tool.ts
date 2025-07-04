#!/usr/bin/env tsx
// TDD Phase 2: Memory Overview Tool Tests
// Author: PB and Claude
// Date: 2025-07-04
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// Memory Overview Tool Unit Tests (TDD Implementation)

import { MemoryOverviewTool } from '../src/tools/memory-overview.js';
import { DatabaseService } from '../src/db/service.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

// Mock DatabaseService for testing
class MockDatabaseService {
  async getDevMemories(limit?: number): Promise<any[]> {
    return [
      {
        memory_id: 'test-memory-1',
        content: 'Test memory content',
        content_type: 'code',
        metadata: '{"implementation_status": "completed"}',
        created_at: '2025-07-04T00:00:00.000Z'
      }
    ];
  }
}

class MemoryOverviewToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Memory Overview Tool Unit Tests (TDD)');
    console.error('===========================================\n');

    // Run all tests
    await this.testBasicFunctionality();
    await this.testErrorHandling();
    await this.testResponseFormat();
    await this.testMemoryDisplay();

    this.printResults();
  }

  private async testBasicFunctionality(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new MemoryOverviewTool(mockDb);
      
      const result = await tool.handle({});
      
      if (!result.content || result.content.length === 0) {
        throw new Error('Tool should return content');
      }
      
      if (result.content[0].type !== 'text') {
        throw new Error('Content type should be text');
      }
      
      const responseText = result.content[0].text;
      if (!responseText.includes('Memory System Overview')) {
        throw new Error('Response should contain overview section');
      }
      
      this.results.push({ name: 'Basic Functionality', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Basic Functionality', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testErrorHandling(): Promise<void> {
    try {
      // Mock a failing database service
      const mockDb = {
        getDevMemories: async () => { throw new Error('Database connection failed'); }
      } as any;
      
      const tool = new MemoryOverviewTool(mockDb);
      const result = await tool.handle({});
      
      if (!result.isError) {
        throw new Error('Tool should return error response when database fails');
      }
      
      if (!result.content[0].text.includes('Error in memory-overview')) {
        throw new Error('Error response should include context');
      }
      
      this.results.push({ name: 'Error Handling', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Error Handling', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testResponseFormat(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new MemoryOverviewTool(mockDb);
      
      const result = await tool.handle({});
      
      // Should not be an error
      if (result.isError) {
        throw new Error('Successful response should not be marked as error');
      }
      
      // Should have proper content structure
      if (!Array.isArray(result.content)) {
        throw new Error('Content should be an array');
      }
      
      // Content should be valid JSON
      const responseText = result.content[0].text;
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new Error('Response text should be valid JSON');
      }
      
      // Should have expected overview sections
      if (!parsed['🧠 Memory System Overview']) {
        throw new Error('Response should contain memory system overview section');
      }
      
      this.results.push({ name: 'Response Format', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Response Format', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testMemoryDisplay(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new MemoryOverviewTool(mockDb);
      
      const result = await tool.handle({});
      const responseText = result.content[0].text;
      const parsed = JSON.parse(responseText);
      
      // Should include recent memories preview
      if (!parsed['🏷️ Recent Memories Preview']) {
        throw new Error('Response should contain recent memories preview');
      }
      
      const recentMemories = parsed['🏷️ Recent Memories Preview'];
      if (!Array.isArray(recentMemories) || recentMemories.length === 0) {
        throw new Error('Recent memories should be a non-empty array');
      }
      
      // Each memory should have expected fields
      const memory = recentMemories[0];
      if (!memory.id || !memory.type || !memory.preview) {
        throw new Error('Memory entries should have id, type, and preview fields');
      }
      
      this.results.push({ name: 'Memory Display', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Memory Display', 
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
      console.error('🎉 All memory overview tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some memory overview tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new MemoryOverviewToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Memory overview tool tests failed to run:', error);
  process.exit(1);
});