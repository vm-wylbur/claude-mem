#!/usr/bin/env tsx
// TDD Phase 2: List Memories By Tag Tool Tests

import { ListMemoriesByTagTool } from '../src/tools/list-memories-by-tag.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MockDatabaseService {
  async getDevMemoriesByTag(tagName: string, limit: number) {
    if (tagName === 'typescript') {
      return Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
        memory_id: `ts-memory-${i}`,
        content: `TypeScript memory content ${i}`,
        content_type: 'code',
        metadata: '{"implementation_status": "completed"}',
        created_at: `2025-07-04T0${i}:00:00Z`
      }));
    }
    return [];
  }
}

const mockFormatHashForDisplay = (hashId: string) => hashId.padStart(16, '0');

class ListMemoriesByTagToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 List Memories By Tag Tool Unit Tests (TDD)');
    console.error('==============================================\n');

    await this.testValidTagSearch();
    await this.testNoMemoriesFound();
    await this.testLimitParameter();
    await this.testResponseFormat();

    this.printResults();
  }

  private async testValidTagSearch(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new ListMemoriesByTagTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        tagName: 'typescript',
        limit: 5
      });
      
      if (result.isError) {
        throw new Error('Valid tag search should not return error');
      }
      
      const memories = JSON.parse(result.content[0].text);
      if (!Array.isArray(memories) || memories.length === 0) {
        throw new Error('Should return array of memories for valid tag');
      }
      
      this.results.push({ name: 'Valid Tag Search', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Valid Tag Search', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testNoMemoriesFound(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new ListMemoriesByTagTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        tagName: 'nonexistent',
        limit: 10
      });
      
      if (result.isError) {
        throw new Error('No memories found should not cause error');
      }
      
      if (!result.content[0].text.includes('No memories found with tag')) {
        throw new Error('Should indicate no memories found');
      }
      
      this.results.push({ name: 'No Memories Found', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'No Memories Found', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testLimitParameter(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new ListMemoriesByTagTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        tagName: 'typescript',
        limit: 1
      });
      
      const memories = JSON.parse(result.content[0].text);
      if (memories.length > 1) {
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

  private async testResponseFormat(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new ListMemoriesByTagTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        tagName: 'typescript'
      });
      
      if (result.isError) {
        throw new Error('Should return valid response');
      }
      
      const memories = JSON.parse(result.content[0].text);
      if (memories.length > 0) {
        const firstMemory = memories[0];
        if (!firstMemory.memory_id || !firstMemory.content) {
          throw new Error('Memories should have required fields');
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
      console.error('🎉 All list memories by tag tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some list memories by tag tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new ListMemoriesByTagToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 List memories by tag tool tests failed to run:', error);
  process.exit(1);
});