#!/usr/bin/env tsx
// TDD Phase 2: List Dev Memories Tool Tests
// Author: PB and Claude
// Date: 2025-07-04

import { ListDevMemoriesTool } from '../src/tools/list-dev-memories.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MockDatabaseService {
  async getDevMemories(limit?: number) {
    const memories = [];
    const actualLimit = limit || 10;
    for (let i = 0; i < Math.min(actualLimit, 3); i++) {
      memories.push({
        memory_id: `abcd123${i}`,
        content: `Test memory content ${i}`,
        content_type: 'code',
        metadata: '{"implementation_status": "completed"}',
        created_at: `2025-07-04T0${i}:00:00Z`
      });
    }
    return memories;
  }
}

class ListDevMemoriesToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 List Dev Memories Tool Unit Tests (TDD)');
    console.error('==========================================\n');

    await this.testBasicListing();
    await this.testLimitParameter();
    await this.testEmptyResults();
    await this.testResponseFormat();

    this.printResults();
  }

  private async testBasicListing(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new ListDevMemoriesTool(mockDb);
      
      const result = await tool.handle({});
      
      if (result.isError) {
        throw new Error('Basic listing should not return error');
      }
      
      const memories = JSON.parse(result.content[0].text);
      if (!Array.isArray(memories)) {
        throw new Error('Result should be an array of memories');
      }
      
      this.results.push({ name: 'Basic Listing', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Basic Listing', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testLimitParameter(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new ListDevMemoriesTool(mockDb);
      
      const result = await tool.handle({ limit: 2 });
      
      if (result.isError) {
        throw new Error('Limit parameter should not cause error');
      }
      
      const memories = JSON.parse(result.content[0].text);
      if (memories.length > 2) {
        throw new Error('Should respect limit parameter');
      }
      
      this.results.push({ name: 'Limit Parameter', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Limit Parameter', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testEmptyResults(): Promise<void> {
    try {
      const emptyDb = {
        getDevMemories: async () => []
      } as any;
      
      const tool = new ListDevMemoriesTool(emptyDb);
      const result = await tool.handle({});
      
      if (result.isError) {
        throw new Error('Empty results should not cause error');
      }
      
      const memories = JSON.parse(result.content[0].text);
      if (memories.length !== 0) {
        throw new Error('Should return empty array for no memories');
      }
      
      this.results.push({ name: 'Empty Results', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Empty Results', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testResponseFormat(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new ListDevMemoriesTool(mockDb);
      
      const result = await tool.handle({});
      const memories = JSON.parse(result.content[0].text);
      
      if (memories.length > 0) {
        const firstMemory = memories[0];
        if (!firstMemory.memory_id || !firstMemory.content || !firstMemory.content_type) {
          throw new Error('Memory should have required fields');
        }
        
        // Check that memory_id is formatted as hex
        if (!/^[0-9a-f]+$/i.test(firstMemory.memory_id)) {
          throw new Error('Memory ID should be formatted as hex');
        }
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
      console.error('🎉 All list dev memories tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some list dev memories tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new ListDevMemoriesToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 List dev memories tool tests failed to run:', error);
  process.exit(1);
});