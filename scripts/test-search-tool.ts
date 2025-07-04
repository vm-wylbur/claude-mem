#!/usr/bin/env tsx
// TDD Phase 2: Search Tool Tests

import { SearchTool } from '../src/tools/search.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MockDatabaseService {
  async findSimilarMemories(searchTerm: string, limit: number) {
    return [
      {
        memory_id: 'abc123',
        content: `Found content related to ${searchTerm}`,
        content_type: 'code',
        metadata: '{"implementation_status": "completed"}',
        created_at: '2025-07-04T00:00:00Z',
        similarity: 0.95
      }
    ];
  }
}

const mockFormatHashForDisplay = (hashId: string) => hashId.padStart(16, '0');

class SearchToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Search Tool Unit Tests (TDD)');
    console.error('===============================\n');

    await this.testBasicSearch();
    await this.testEmptyResults();
    await this.testResponseFormat();
    await this.testSimilarityScoring();

    this.printResults();
  }

  private async testBasicSearch(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new SearchTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({ searchTerm: 'test query' });
      
      if (result.isError) {
        throw new Error('Basic search should not return error');
      }
      
      const results = JSON.parse(result.content[0].text);
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error('Should return array of search results');
      }
      
      this.results.push({ name: 'Basic Search', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Basic Search', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testEmptyResults(): Promise<void> {
    try {
      const emptyDb = {
        findSimilarMemories: async () => []
      } as any;
      
      const tool = new SearchTool(emptyDb, mockFormatHashForDisplay);
      const result = await tool.handle({ searchTerm: 'nonexistent' });
      
      if (result.isError) {
        throw new Error('Empty results should not cause error');
      }
      
      if (!result.content[0].text.includes('No similar memories found')) {
        throw new Error('Should indicate no results found');
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
      const tool = new SearchTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({ searchTerm: 'test' });
      const results = JSON.parse(result.content[0].text);
      
      if (results.length > 0) {
        const firstResult = results[0];
        if (!firstResult.id || !firstResult.similarity || !firstResult.content) {
          throw new Error('Results should have required fields');
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

  private async testSimilarityScoring(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new SearchTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({ searchTerm: 'test' });
      const results = JSON.parse(result.content[0].text);
      
      if (results.length > 0) {
        const firstResult = results[0];
        if (!firstResult.similarity.includes('%')) {
          throw new Error('Similarity should be formatted as percentage');
        }
      }
      
      this.results.push({ name: 'Similarity Scoring', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Similarity Scoring', 
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
      console.error('🎉 All search tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some search tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new SearchToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Search tool tests failed to run:', error);
  process.exit(1);
});