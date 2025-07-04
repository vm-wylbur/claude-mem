#!/usr/bin/env tsx
// TDD Phase 2: Get All Tags Tool Tests

import { GetAllTagsTool } from '../src/tools/get-all-tags.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MockDatabaseService {
  async getDevTags() {
    return ['typescript', 'tdd', 'refactoring', 'testing', 'mcp'];
  }
}

class GetAllTagsToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Get All Tags Tool Unit Tests (TDD)');
    console.error('===================================\n');

    await this.testBasicTagRetrieval();
    await this.testEmptyTags();
    await this.testResponseFormat();
    await this.testErrorHandling();

    this.printResults();
  }

  private async testBasicTagRetrieval(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetAllTagsTool(mockDb);
      
      const result = await tool.handle({});
      
      if (result.isError) {
        throw new Error('Tag retrieval should not return error');
      }
      
      const tags = JSON.parse(result.content[0].text);
      if (!Array.isArray(tags) || tags.length === 0) {
        throw new Error('Should return array of tags');
      }
      
      this.results.push({ name: 'Basic Tag Retrieval', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Basic Tag Retrieval', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testEmptyTags(): Promise<void> {
    try {
      const emptyDb = {
        getDevTags: async () => []
      } as any;
      
      const tool = new GetAllTagsTool(emptyDb);
      const result = await tool.handle({});
      
      if (result.isError) {
        throw new Error('Empty tags should not cause error');
      }
      
      if (!result.content[0].text.includes('No tags found')) {
        throw new Error('Should indicate no tags found');
      }
      
      this.results.push({ name: 'Empty Tags', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Empty Tags', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testResponseFormat(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetAllTagsTool(mockDb);
      
      const result = await tool.handle({});
      
      if (result.isError) {
        throw new Error('Should return valid response');
      }
      
      const tags = JSON.parse(result.content[0].text);
      if (!Array.isArray(tags)) {
        throw new Error('Response should be array');
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

  private async testErrorHandling(): Promise<void> {
    try {
      const errorDb = {
        getDevTags: async () => { throw new Error('Database error'); }
      } as any;
      
      const tool = new GetAllTagsTool(errorDb);
      const result = await tool.handle({});
      
      if (!result.isError) {
        throw new Error('Database error should return error response');
      }
      
      if (!result.content[0].text.includes('Error in retrieving tags')) {
        throw new Error('Should include error context');
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
      console.error('🎉 All get all tags tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some get all tags tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new GetAllTagsToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Get all tags tool tests failed to run:', error);
  process.exit(1);
});