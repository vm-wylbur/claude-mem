#!/usr/bin/env tsx
// TDD Phase 2: Get Dev Memory Tool Tests

import { GetDevMemoryTool } from '../src/tools/get-dev-memory.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MockDatabaseService {
  async getMemory(hashId: string) {
    if (hashId === 'valid-hash-id') {
      return {
        memory_id: 'valid-hash-id',
        content: 'Test memory content',
        content_type: 'code',
        metadata: '{"implementation_status": "completed"}',
        created_at: '2025-07-04T00:00:00Z'
      };
    }
    return null;
  }
}

// Mock hash utility functions
const mockParseHexToHash = (hexId: string) => {
  if (hexId === 'abcd1234') return 'valid-hash-id';
  throw new Error('Invalid hex format');
};

const mockIsValidHashId = (hashId: string) => hashId === 'valid-hash-id';
const mockFormatHashForDisplay = (hashId: string) => hashId;

class GetDevMemoryToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Get Dev Memory Tool Unit Tests (TDD)');
    console.error('=====================================\n');

    await this.testValidMemoryRetrieval();
    await this.testMemoryNotFound();
    await this.testInvalidHashFormat();
    await this.testResponseFormat();

    this.printResults();
  }

  private async testValidMemoryRetrieval(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetDevMemoryTool(mockDb, mockParseHexToHash, mockIsValidHashId, mockFormatHashForDisplay);
      
      const result = await tool.handle({ memoryId: 'abcd1234' });
      
      if (result.isError) {
        throw new Error('Valid memory retrieval should not return error');
      }
      
      const memory = JSON.parse(result.content[0].text);
      if (!memory.memory_id || !memory.content) {
        throw new Error('Should return complete memory object');
      }
      
      this.results.push({ name: 'Valid Memory Retrieval', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Valid Memory Retrieval', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testMemoryNotFound(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const mockParseValid = () => 'nonexistent-hash';
      const mockValidateValid = () => true;
      
      const tool = new GetDevMemoryTool(mockDb, mockParseValid, mockValidateValid, mockFormatHashForDisplay);
      
      const result = await tool.handle({ memoryId: 'abcd1234' });
      
      if (!result.isError) {
        throw new Error('Nonexistent memory should return error');
      }
      
      if (!result.content[0].text.includes('not found')) {
        throw new Error('Should indicate memory was not found');
      }
      
      this.results.push({ name: 'Memory Not Found', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Memory Not Found', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testInvalidHashFormat(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetDevMemoryTool(mockDb, mockParseHexToHash, mockIsValidHashId, mockFormatHashForDisplay);
      
      const result = await tool.handle({ memoryId: 'invalid-format' });
      
      if (!result.isError) {
        throw new Error('Invalid hash format should return error');
      }
      
      if (!result.content[0].text.includes('Invalid memory ID format')) {
        throw new Error('Should indicate invalid format');
      }
      
      this.results.push({ name: 'Invalid Hash Format', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Invalid Hash Format', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testResponseFormat(): Promise<void> {
    try {
      const mockDb = new MockDatabaseService() as any;
      const tool = new GetDevMemoryTool(mockDb, mockParseHexToHash, mockIsValidHashId, mockFormatHashForDisplay);
      
      const result = await tool.handle({ memoryId: 'abcd1234' });
      
      if (result.isError) {
        throw new Error('Should return valid response for existing memory');
      }
      
      const memory = JSON.parse(result.content[0].text);
      if (typeof memory !== 'object' || !memory.memory_id) {
        throw new Error('Should return properly formatted memory object');
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
      console.error('🎉 All get dev memory tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some get dev memory tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new GetDevMemoryToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Get dev memory tool tests failed to run:', error);
  process.exit(1);
});