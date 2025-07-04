#!/usr/bin/env tsx
// TDD Phase 2: Store Dev Memory Tool Tests
// Author: PB and Claude
// Date: 2025-07-04

import { StoreDevMemoryTool } from '../src/tools/store-dev-memory.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

// Mock DatabaseService for testing
class MockDatabaseService {
  async addMemoryTags(memoryId: string, tags: string[]): Promise<void> {
    // Mock implementation
  }
}

// Mock storeMemoryWithTags function
const mockStoreMemoryWithTags = async (content: string, type: string, metadata: any, tags?: string[]): Promise<string> => {
  return 'mock-memory-id-123';
};

class StoreDevMemoryToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Store Dev Memory Tool Unit Tests (TDD)');
    console.error('===========================================\n');

    await this.testBasicStorage();
    await this.testWithTags();
    await this.testWithFullMetadata();
    await this.testErrorHandling();

    this.printResults();
  }

  private async testBasicStorage(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new StoreDevMemoryTool(mockDb, mockStoreMemoryWithTags);
      
      const params = {
        content: 'Test memory content',
        type: 'code' as const
      };
      
      const result = await tool.handle(params);
      
      if (result.isError) {
        throw new Error('Basic storage should not return error');
      }
      
      if (!result.content[0].text.includes('Successfully stored memory')) {
        throw new Error('Response should confirm storage success');
      }
      
      if (!result.content[0].text.includes('mock-memory-id-123')) {
        throw new Error('Response should include memory ID');
      }
      
      this.results.push({ name: 'Basic Storage', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Basic Storage', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testWithTags(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new StoreDevMemoryTool(mockDb, mockStoreMemoryWithTags);
      
      const params = {
        content: 'Test memory with tags',
        type: 'code' as const,
        tags: ['test', 'typescript', 'tdd']
      };
      
      const result = await tool.handle(params);
      
      if (result.isError) {
        throw new Error('Storage with tags should not return error');
      }
      
      if (!result.content[0].text.includes('Successfully stored memory')) {
        throw new Error('Response should confirm storage success');
      }
      
      this.results.push({ name: 'Storage With Tags', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Storage With Tags', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testWithFullMetadata(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new StoreDevMemoryTool(mockDb, mockStoreMemoryWithTags);
      
      const params = {
        content: 'Test memory with full metadata',
        type: 'decision' as const,
        keyDecisions: ['Use TDD approach', 'Extract tools to modules'],
        status: 'completed',
        codeChanges: ['src/tools/store-dev-memory.ts'],
        filesCreated: ['scripts/test-store-dev-memory-tool.ts'],
        tags: ['tdd', 'decision']
      };
      
      const result = await tool.handle(params);
      
      if (result.isError) {
        throw new Error('Storage with full metadata should not return error');
      }
      
      this.results.push({ name: 'Full Metadata Storage', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Full Metadata Storage', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testErrorHandling(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      
      // Mock function that throws error
      const failingStoreFunction = async () => {
        throw new Error('Database storage failed');
      };
      
      const tool = new StoreDevMemoryTool(mockDb, failingStoreFunction);
      
      const params = {
        content: 'Test content',
        type: 'code' as const
      };
      
      const result = await tool.handle(params);
      
      if (!result.isError) {
        throw new Error('Tool should return error when storage fails');
      }
      
      if (!result.content[0].text.includes('Error in store-dev-memory')) {
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
      console.error('🎉 All store dev memory tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some store dev memory tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new StoreDevMemoryToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Store dev memory tool tests failed to run:', error);
  process.exit(1);
});