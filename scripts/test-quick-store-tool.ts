#!/usr/bin/env tsx
// TDD Phase 2: Quick Store Tool Tests
// Author: PB and Claude
// Date: 2025-07-04

import { QuickStoreTool } from '../src/tools/quick-store.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

// Mock functions
const mockDetectMemoryType = (content: string) => 'code';
const mockGenerateSmartTags = async (content: string, type: string) => ['typescript', 'test'];
const mockStoreMemoryWithTags = async () => 'mock-memory-id-456';

class QuickStoreToolTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Quick Store Tool Unit Tests (TDD)');
    console.error('=====================================\n');

    await this.testAutoDetection();
    await this.testWithOverrideType();
    await this.testWithAdditionalTags();
    await this.testDecisionExtraction();

    this.printResults();
  }

  private async testAutoDetection(): Promise<void> {
    try {
      const tool = new QuickStoreTool(
        {} as any,
        mockStoreMemoryWithTags,
        mockDetectMemoryType,
        mockGenerateSmartTags
      );
      
      const params = {
        content: 'function test() { return true; }'
      };
      
      const result = await tool.handle(params);
      
      if (result.isError) {
        throw new Error('Auto detection should not return error');
      }
      
      const response = JSON.parse(result.content[0].text);
      if (!response.success) {
        throw new Error('Response should indicate success');
      }
      
      if (!response.autoDetected) {
        throw new Error('Should mark as auto-detected when no type provided');
      }
      
      this.results.push({ name: 'Auto Detection', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Auto Detection', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testWithOverrideType(): Promise<void> {
    try {
      const tool = new QuickStoreTool(
        {} as any,
        mockStoreMemoryWithTags,
        mockDetectMemoryType,
        mockGenerateSmartTags
      );
      
      const params = {
        content: 'Some content',
        type: 'decision' as const
      };
      
      const result = await tool.handle(params);
      const response = JSON.parse(result.content[0].text);
      
      if (response.autoDetected) {
        throw new Error('Should not mark as auto-detected when type provided');
      }
      
      this.results.push({ name: 'Type Override', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Type Override', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testWithAdditionalTags(): Promise<void> {
    try {
      const tool = new QuickStoreTool(
        {} as any,
        mockStoreMemoryWithTags,
        mockDetectMemoryType,
        mockGenerateSmartTags
      );
      
      const params = {
        content: 'Some content',
        tags: ['custom', 'user-tag']
      };
      
      const result = await tool.handle(params);
      const response = JSON.parse(result.content[0].text);
      
      if (!response.tags.includes('custom') || !response.tags.includes('user-tag')) {
        throw new Error('User tags should be included in final tag list');
      }
      
      this.results.push({ name: 'Additional Tags', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Additional Tags', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async testDecisionExtraction(): Promise<void> {
    try {
      const mockDetectDecision = (content: string) => 'decision';
      
      const tool = new QuickStoreTool(
        {} as any,
        mockStoreMemoryWithTags,
        mockDetectDecision,
        mockGenerateSmartTags
      );
      
      const params = {
        content: 'We decided to use TDD approach. We chose TypeScript over JavaScript.'
      };
      
      const result = await tool.handle(params);
      const response = JSON.parse(result.content[0].text);
      
      if (!response.keyDecisions || response.keyDecisions.length === 0) {
        throw new Error('Should extract key decisions from decision-type content');
      }
      
      this.results.push({ name: 'Decision Extraction', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Decision Extraction', 
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
      console.error('🎉 All quick store tool tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some quick store tool tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new QuickStoreToolTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Quick store tool tests failed to run:', error);
  process.exit(1);
});