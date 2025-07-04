#!/usr/bin/env tsx
// TDD Phase 2: Get Recent Context Tool Tests
// Author: PB and Claude
// Date: 2025-07-04

import { GetRecentContextTool } from '../src/tools/get-recent-context.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

// Mock database service
class MockDatabaseService {
  async getDevMemories(limit?: number) {
    return [
      {
        memory_id: 'test-id-1',
        content: 'Recent memory content 1',
        content_type: 'code',
        metadata: '{"implementation_status": "completed"}',
        created_at: '2025-07-04T02:00:00Z'
      },
      {
        memory_id: 'test-id-2',
        content: 'Recent memory content 2',
        content_type: 'decision',
        metadata: '{"key_decisions": ["Use TDD approach"]}',
        created_at: '2025-07-04T01:00:00Z'
      }
    ];
  }

  async getMemoryTags(memoryId: string) {
    return ['tag1', 'tag2'];
  }
}

class GetRecentContextToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Get Recent Context Tool Unit Tests (TDD)');
    console.error('============================================\n');

    await this.testBasicRetrieval();
    await this.testDateFiltering();
    await this.testTypeFiltering();
    await this.testFormatOptions();

    this.printResults();
  }

  private async testBasicRetrieval(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetRecentContextTool(mockDb);
      
      const result = await tool.handle({ limit: 5 });
      
      if (result.isError) {
        throw new Error('Basic retrieval should not return error');
      }
      
      const response = JSON.parse(result.content[0].text);
      if (!response.contextSummary) {
        throw new Error('Response should contain context summary');
      }
      
      if (!response.memories || !Array.isArray(response.memories)) {
        throw new Error('Response should contain memories array');
      }
      
      this.results.push({ name: 'Basic Retrieval', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Basic Retrieval', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testDateFiltering(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetRecentContextTool(mockDb);
      
      const params = {
        limit: 5,
        since: '2025-07-04T01:30:00Z'
      };
      
      const result = await tool.handle(params);
      
      if (result.isError) {
        throw new Error('Date filtering should not return error');
      }
      
      const response = JSON.parse(result.content[0].text);
      if (response.contextSummary.filter.since !== '2025-07-04T01:30:00Z') {
        throw new Error('Filter should be recorded in context summary');
      }
      
      this.results.push({ name: 'Date Filtering', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Date Filtering', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testTypeFiltering(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetRecentContextTool(mockDb);
      
      const params = {
        limit: 5,
        types: ['code', 'decision'] as any[]
      };
      
      const result = await tool.handle(params);
      
      if (result.isError) {
        throw new Error('Type filtering should not return error');
      }
      
      const response = JSON.parse(result.content[0].text);
      if (!Array.isArray(response.contextSummary.filter.types)) {
        throw new Error('Type filter should be recorded in context summary');
      }
      
      this.results.push({ name: 'Type Filtering', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Type Filtering', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testFormatOptions(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetRecentContextTool(mockDb);
      
      // Test different format options
      const formats = ['full', 'summary', 'context'] as const;
      
      for (const format of formats) {
        const result = await tool.handle({ limit: 2, format });
        
        if (result.isError) {
          throw new Error(`Format ${format} should not return error`);
        }
        
        const response = JSON.parse(result.content[0].text);
        if (!response.memories || response.memories.length === 0) {
          throw new Error(`Format ${format} should return memories`);
        }
      }
      
      this.results.push({ name: 'Format Options', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Format Options', 
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
      console.error('🎉 All get recent context tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some get recent context tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new GetRecentContextToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Get recent context tool tests failed to run:', error);
  process.exit(1);
});