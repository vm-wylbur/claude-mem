#!/usr/bin/env tsx
// TDD Phase 2: Search Enhanced Tool Tests

import { SearchEnhancedTool } from '../src/tools/search-enhanced.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MockDatabaseService {
  async findSimilarMemories(query: string, limit: number) {
    return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      memory_id: `abc12${i}`,
      content: `Enhanced search result ${i} for ${query}`,
      content_type: 'code',
      metadata: '{"implementation_status": "completed"}',
      created_at: `2025-07-04T0${i}:00:00Z`,
      similarity: 0.9 - (i * 0.1)
    }));
  }

  async getMemoryTags(memoryId: string) {
    return ['enhanced', 'search', 'test'];
  }
}

const mockFormatHashForDisplay = (hashId: string) => hashId.padStart(16, '0');

class SearchEnhancedToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Search Enhanced Tool Unit Tests (TDD)');
    console.error('========================================\n');

    await this.testBasicEnhancedSearch();
    await this.testFilteringOptions();
    await this.testScoringAndSorting();
    await this.testResponseStructure();

    this.printResults();
  }

  private async testBasicEnhancedSearch(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new SearchEnhancedTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        query: 'test search',
        limit: 3
      });
      
      if (result.isError) {
        throw new Error('Basic enhanced search should not return error');
      }
      
      const response = JSON.parse(result.content[0].text);
      if (!response.searchSummary || !response.results) {
        throw new Error('Should return structured response with summary and results');
      }
      
      this.results.push({ name: 'Basic Enhanced Search', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Basic Enhanced Search', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testFilteringOptions(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new SearchEnhancedTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        query: 'test',
        minSimilarity: 0.5,
        types: ['code', 'decision'],
        limit: 2
      });
      
      const response = JSON.parse(result.content[0].text);
      
      if (!response.searchSummary.appliedFilters) {
        throw new Error('Should include applied filters in summary');
      }
      
      this.results.push({ name: 'Filtering Options', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Filtering Options', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testScoringAndSorting(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new SearchEnhancedTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        query: 'test',
        showScores: true,
        sortBy: 'similarity'
      });
      
      const response = JSON.parse(result.content[0].text);
      
      if (response.results.length > 0) {
        const firstResult = response.results[0];
        if (!firstResult.similarity || !firstResult.score) {
          throw new Error('Should include similarity scores when requested');
        }
      }
      
      this.results.push({ name: 'Scoring And Sorting', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Scoring And Sorting', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testResponseStructure(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new SearchEnhancedTool(mockDb, mockFormatHashForDisplay);
      
      const result = await tool.handle({
        query: 'test',
        includeTags: true
      });
      
      const response = JSON.parse(result.content[0].text);
      
      if (!response.searchSummary.searchQuery) {
        throw new Error('Search summary should include query');
      }
      
      if (!response.searchSummary.totalResults) {
        throw new Error('Search summary should include result count');
      }
      
      this.results.push({ name: 'Response Structure', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Response Structure', 
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
      console.error('🎉 All search enhanced tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some search enhanced tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new SearchEnhancedToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Search enhanced tool tests failed to run:', error);
  process.exit(1);
});