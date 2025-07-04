#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2025-07-03
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// scripts/test-phase1-extensions.ts

/**
 * Phase 1 Extension Integration Tests
 * 
 * Tests the Phase 1 smart memory automation tools:
 * - quick-store (auto-detection and smart tagging)
 * - get-recent-context (session continuity)
 * - search-enhanced (advanced filtering and scoring)
 */

import { config } from 'dotenv';
import { PostgresAdapter } from '../src/db/adapters/postgres.js';
import { DatabaseService } from '../src/db/service.js';
import { initializeHasher } from '../src/utils/hash.js';
import { generateEmbedding } from '../src/embeddings.js';
import type { DatabaseConfig } from '../src/db/adapters/base.js';

config();

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

class Phase1ExtensionTester {
  private adapter: PostgresAdapter | null = null;
  private service: DatabaseService | null = null;
  private results: TestResult[] = [];
  private testMemoryIds: string[] = [];

  async runAllTests(): Promise<void> {
    console.error('🚀 Phase 1 Extension Integration Tests');
    console.error('=====================================\n');

    try {
      await this.setup();
      
      // Run tests in order (some depend on previous ones)
      await this.testQuickStoreBasic();
      await this.testQuickStoreAutoDetection();
      await this.testQuickStoreSmartTagging();
      await this.testGetRecentContext();
      await this.testSearchEnhanced();
      
      await this.cleanup();
      this.printResults();
      
    } catch (error) {
      console.error('💥 Test setup failed:', error);
      process.exit(1);
    }
  }

  private async setup(): Promise<void> {
    console.error('🔧 Setting up test environment...');
    
    // Initialize hash utility
    await initializeHasher();
    
    // Create database config (simplified for testing)
    const config: DatabaseConfig = {
      type: 'postgresql',
      postgresql: {
        hosts: (process.env.MCPMEM_PG_HOSTS || 'localhost').split(','),
        database: process.env.MCPMEM_PG_DATABASE || 'claude_mem',
        user: process.env.MCPMEM_PG_USER || 'pball',
        password: process.env.MCPMEM_PG_PASSWORD,
        port: process.env.MCPMEM_PG_PORT ? parseInt(process.env.MCPMEM_PG_PORT) : 5432,
      }
    };
    
    // Create adapter and service
    this.adapter = new PostgresAdapter(config);
    await this.adapter.connect();
    
    this.service = new DatabaseService(this.adapter);
    
    console.error('✅ Test environment ready\n');
  }

  private async cleanup(): Promise<void> {
    console.error('\n🧹 Cleaning up test data...');
    
    // Clean up any test memories we created
    if (this.adapter && this.testMemoryIds.length > 0) {
      try {
        for (const memoryId of this.testMemoryIds) {
          // Note: In a real implementation, we'd have a delete method
          // For now, just note which test memories were created
          console.error(`  Test memory created: ${memoryId}`);
        }
      } catch (error) {
        console.error('Warning: Could not clean up all test memories:', error);
      }
    }
    
    if (this.adapter) {
      await this.adapter.disconnect();
    }
    
    console.error('✅ Cleanup complete');
  }

  private async testQuickStoreBasic(): Promise<void> {
    const testName = 'Quick-Store Basic Functionality';
    const startTime = Date.now();
    
    try {
      if (!this.service) throw new Error('Service not initialized');
      
      const testContent = "Testing basic quick-store functionality with auto-detection.";
      
      // Test quick store (simulating the MCP tool)
      const result = await this.service.quickStore({
        content: testContent,
        status: 'completed'
      });
      
      if (!result.memory_id) {
        throw new Error('Quick-store did not return a memory ID');
      }
      
      // Verify the memory was stored
      const retrieved = await this.service.getDevMemory(result.memory_id);
      if (!retrieved || retrieved.content !== testContent) {
        throw new Error('Stored memory could not be retrieved or content mismatch');
      }
      
      this.testMemoryIds.push(result.memory_id);
      
      const duration = Date.now() - startTime;
      this.results.push({ name: testName, passed: true, duration });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.push({ 
        name: testName, 
        passed: false, 
        error: error instanceof Error ? error.message : String(error),
        duration
      });
    }
  }

  private async testQuickStoreAutoDetection(): Promise<void> {
    const testName = 'Quick-Store Auto-Detection';
    const startTime = Date.now();
    
    try {
      if (!this.service) throw new Error('Service not initialized');
      
      // Test different content types for auto-detection
      const testCases = [
        {
          content: "async function generateHash(content: string) { return hash; }",
          expectedType: "code"
        },
        {
          content: "We decided to use PostgreSQL instead of SQLite for better concurrency.",
          expectedType: "decision"
        },
        {
          content: "Here's the documentation link: https://docs.example.com/api",
          expectedType: "reference"
        },
        {
          content: "Let's discuss the implementation approach for this feature.",
          expectedType: "conversation"
        }
      ];
      
      for (const testCase of testCases) {
        const result = await this.service.quickStore({
          content: testCase.content,
          status: 'completed'
        });
        
        const retrieved = await this.service.getDevMemory(result.memory_id);
        if (!retrieved) {
          throw new Error(`Could not retrieve memory ${result.memory_id}`);
        }
        
        if (retrieved.type !== testCase.expectedType) {
          throw new Error(
            `Auto-detection failed for "${testCase.content.substring(0, 30)}...": ` +
            `expected ${testCase.expectedType}, got ${retrieved.type}`
          );
        }
        
        this.testMemoryIds.push(result.memory_id);
      }
      
      const duration = Date.now() - startTime;
      this.results.push({ name: testName, passed: true, duration });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.push({ 
        name: testName, 
        passed: false, 
        error: error instanceof Error ? error.message : String(error),
        duration
      });
    }
  }

  private async testQuickStoreSmartTagging(): Promise<void> {
    const testName = 'Quick-Store Smart Tagging';
    const startTime = Date.now();
    
    try {
      if (!this.service) throw new Error('Service not initialized');
      
      const testContent = "Implemented PostgreSQL migration with TypeScript and pgvector for embeddings.";
      
      const result = await this.service.quickStore({
        content: testContent,
        status: 'completed'
      });
      
      const retrieved = await this.service.getDevMemory(result.memory_id);
      if (!retrieved) {
        throw new Error('Could not retrieve memory with smart tags');
      }
      
      // Check that smart tags were generated
      if (!retrieved.tags || retrieved.tags.length === 0) {
        throw new Error('Smart tagging did not generate any tags');
      }
      
      // Look for expected technology tags
      const tagNames = retrieved.tags.map(tag => tag.name.toLowerCase());
      const expectedTags = ['postgresql', 'typescript', 'pgvector'];
      const foundExpectedTags = expectedTags.filter(tag => 
        tagNames.some(t => t.includes(tag))
      );
      
      if (foundExpectedTags.length === 0) {
        console.error(`Generated tags: ${tagNames.join(', ')}`);
        console.error(`Expected one of: ${expectedTags.join(', ')}`);
        throw new Error('Smart tagging did not detect expected technology tags');
      }
      
      this.testMemoryIds.push(result.memory_id);
      
      const duration = Date.now() - startTime;
      this.results.push({ name: testName, passed: true, duration });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.push({ 
        name: testName, 
        passed: false, 
        error: error instanceof Error ? error.message : String(error),
        duration
      });
    }
  }

  private async testGetRecentContext(): Promise<void> {
    const testName = 'Get Recent Context';
    const startTime = Date.now();
    
    try {
      if (!this.service) throw new Error('Service not initialized');
      
      // Test getting recent context
      const context = await this.service.getRecentContext({
        limit: 3,
        format: 'context'
      });
      
      if (!context.memories || !Array.isArray(context.memories)) {
        throw new Error('Recent context did not return memories array');
      }
      
      if (context.memories.length === 0) {
        throw new Error('Recent context returned no memories');
      }
      
      // Check that memories are properly formatted
      const firstMemory = context.memories[0];
      if (!firstMemory.id || !firstMemory.content || !firstMemory.type) {
        throw new Error('Recent context memory missing required fields');
      }
      
      // Check date range calculation
      if (!context.contextSummary || !context.contextSummary.dateRange) {
        throw new Error('Recent context missing date range summary');
      }
      
      const duration = Date.now() - startTime;
      this.results.push({ name: testName, passed: true, duration });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.push({ 
        name: testName, 
        passed: false, 
        error: error instanceof Error ? error.message : String(error),
        duration
      });
    }
  }

  private async testSearchEnhanced(): Promise<void> {
    const testName = 'Search Enhanced';
    const startTime = Date.now();
    
    try {
      if (!this.service) throw new Error('Service not initialized');
      
      // Test enhanced search with scoring
      const searchResults = await this.service.searchEnhanced({
        query: 'PostgreSQL implementation',
        limit: 5,
        showScores: true,
        minSimilarity: 0.1
      });
      
      if (!searchResults.results || !Array.isArray(searchResults.results)) {
        throw new Error('Enhanced search did not return results array');
      }
      
      // Check that results have similarity scores
      if (searchResults.results.length > 0) {
        const firstResult = searchResults.results[0];
        if (!firstResult.similarity || !firstResult.score) {
          throw new Error('Enhanced search results missing similarity scores');
        }
        
        // Check that similarity is a valid percentage
        const similarity = parseFloat(firstResult.similarity.replace('%', ''));
        if (isNaN(similarity) || similarity < 0 || similarity > 100) {
          throw new Error(`Invalid similarity score: ${firstResult.similarity}`);
        }
      }
      
      // Check search summary
      if (!searchResults.searchSummary) {
        throw new Error('Enhanced search missing search summary');
      }
      
      const duration = Date.now() - startTime;
      this.results.push({ name: testName, passed: true, duration });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.push({ 
        name: testName, 
        passed: false, 
        error: error instanceof Error ? error.message : String(error),
        duration
      });
    }
  }

  private printResults(): void {
    console.error('\n📊 Phase 1 Extension Test Results:');
    console.error('===================================');
    
    let passed = 0;
    let total = this.results.length;
    let totalDuration = 0;
    
    for (const result of this.results) {
      const status = result.passed ? '✅' : '❌';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      console.error(`${status} ${result.name}${duration}`);
      
      if (!result.passed && result.error) {
        console.error(`   Error: ${result.error}`);
      }
      
      if (result.passed) passed++;
      if (result.duration) totalDuration += result.duration;
    }
    
    console.error(`\n📈 Summary: ${passed}/${total} tests passed`);
    console.error(`⏱️  Total time: ${totalDuration}ms`);
    
    if (this.testMemoryIds.length > 0) {
      console.error(`🧪 Created ${this.testMemoryIds.length} test memories`);
    }
    
    if (passed === total) {
      console.error('\n🎉 All Phase 1 Extension tests passed!');
      console.error('✅ quick-store auto-detection working');
      console.error('✅ Smart tagging functional');
      console.error('✅ Recent context retrieval working');
      console.error('✅ Enhanced search with scoring working');
      process.exit(0);
    } else {
      console.error('\n❌ Some Phase 1 Extension tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new Phase1ExtensionTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Phase 1 Extension tests failed:', error);
  process.exit(1);
});