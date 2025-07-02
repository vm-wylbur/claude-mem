#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// scripts/test-postgres.ts

/**
 * PostgreSQL Testing Script
 * 
 * Automated testing for PostgreSQL connectivity, schema, and functionality
 * Tests database operations through the tunnel.
 */

import { config } from 'dotenv';
import { getDatabaseConfig } from '../src/config.js';
import { PostgresAdapter } from '../src/db/adapters/postgres.js';
import { DatabaseService } from '../src/db/service.js';

// Load environment variables
config();

interface TestResult {
  name: string;
  success: boolean;
  message: string;
  duration?: number;
}

class PostgreSQLTester {
  private results: TestResult[] = [];
  private adapter: PostgresAdapter | null = null;
  private service: DatabaseService | null = null;

  async runAllTests(): Promise<void> {
    console.error('🐘 PostgreSQL Test Suite');
    console.error('=========================\n');
    
    try {
      await this.testDatabaseConnection();
      await this.testPgVectorExtension();
      await this.testSchemaExists();
      await this.testBasicOperations();
      await this.testVectorSimilarity();
      await this.testDatabaseService();
    } finally {
      await this.cleanup();
    }
    
    this.printSummary();
  }

  private async testDatabaseConnection(): Promise<void> {
    const testName = 'Database Connection';
    const startTime = Date.now();
    
    try {
      const dbConfig = getDatabaseConfig();
      
      if (dbConfig.type !== 'postgresql') {
        throw new Error('Set MCPMEM_DB_TYPE=postgresql to run PostgreSQL tests');
      }
      
      this.adapter = new PostgresAdapter(dbConfig);
      await this.adapter.connect();
      
      const healthy = await this.adapter.healthCheck();
      if (healthy) {
        this.addResult(testName, true, 'Successfully connected to PostgreSQL', startTime);
      } else {
        this.addResult(testName, false, 'Connected but health check failed', startTime);
      }
    } catch (error) {
      this.addResult(testName, false, `Connection failed: ${error}`, startTime);
    }
  }

  private async testPgVectorExtension(): Promise<void> {
    const testName = 'pgvector Extension';
    const startTime = Date.now();
    
    if (!this.adapter) {
      this.addResult(testName, false, 'No database connection', startTime);
      return;
    }
    
    try {
      // Get the underlying pool to run raw queries
      const pool = (this.adapter as any).pool;
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT extversion FROM pg_extension WHERE extname = 'vector'
        `);
        
        if (result.rows.length > 0) {
          const version = result.rows[0].extversion;
          this.addResult(testName, true, `pgvector extension found (version: ${version})`, startTime);
        } else {
          this.addResult(testName, false, 'pgvector extension not installed', startTime);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      this.addResult(testName, false, `Error checking pgvector: ${error}`, startTime);
    }
  }

  private async testSchemaExists(): Promise<void> {
    const testName = 'Database Schema';
    const startTime = Date.now();
    
    if (!this.adapter) {
      this.addResult(testName, false, 'No database connection', startTime);
      return;
    }
    
    try {
      const pool = (this.adapter as any).pool;
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('projects', 'memories', 'tags', 'memory_tags', 'memory_relationships')
          ORDER BY table_name
        `);
        
        const expectedTables = ['memories', 'memory_relationships', 'memory_tags', 'projects', 'tags'];
        const foundTables = result.rows.map(row => row.table_name).sort();
        
        if (foundTables.length === expectedTables.length) {
          this.addResult(testName, true, `All required tables found: ${foundTables.join(', ')}`, startTime);
        } else {
          this.addResult(testName, false, `Missing tables. Found: ${foundTables.join(', ')}, Expected: ${expectedTables.join(', ')}`, startTime);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      this.addResult(testName, false, `Error checking schema: ${error}`, startTime);
    }
  }

  private async testBasicOperations(): Promise<void> {
    const testName = 'Basic CRUD Operations';
    const startTime = Date.now();
    
    if (!this.adapter) {
      this.addResult(testName, false, 'No database connection', startTime);
      return;
    }
    
    try {
      // Test project creation
      const projectId = await this.adapter.createProject(
        'test-project-' + Date.now(),
        'Test project for automated testing'
      );
      
      // Test memory storage
      const memoryId = await this.adapter.storeMemory(
        'This is a test memory for automated testing',
        'code',
        {
          key_decisions: ['Test automated PostgreSQL operations'],
          implementation_status: 'testing',
          date: new Date().toISOString()
        },
        projectId
      );
      
      // Test memory retrieval
      const memory = await this.adapter.getMemory(memoryId);
      
      if (memory && memory.content.includes('test memory')) {
        this.addResult(testName, true, `CRUD operations successful (project: ${projectId}, memory: ${memoryId})`, startTime);
      } else {
        this.addResult(testName, false, 'Memory retrieval failed or content mismatch', startTime);
      }
    } catch (error) {
      this.addResult(testName, false, `CRUD operations failed: ${error}`, startTime);
    }
  }

  private async testVectorSimilarity(): Promise<void> {
    const testName = 'Vector Similarity Search';
    const startTime = Date.now();
    
    if (!this.adapter) {
      this.addResult(testName, false, 'No database connection', startTime);
      return;
    }
    
    try {
      // Create a test project if we haven't already
      let projectId: number;
      try {
        projectId = await this.adapter.createProject(
          'vector-test-project-' + Date.now(),
          'Vector similarity test project'
        );
      } catch (error) {
        // Project might already exist, get it
        const project = await this.adapter.getProject('memory-mcp-development');
        if (project) {
          projectId = project.project_id;
        } else {
          throw error;
        }
      }
      
      // Store a test memory with embedding
      await this.adapter.storeMemory(
        'Vector similarity search testing with PostgreSQL and pgvector',
        'reference',
        {
          key_decisions: ['Test vector operations'],
          date: new Date().toISOString()
        },
        projectId
      );
      
      // Test similarity search
      const similarMemories = await this.adapter.findSimilarMemories(
        'testing vector similarity with pgvector',
        3,
        projectId
      );
      
      if (similarMemories.length > 0 && similarMemories[0].similarity !== undefined) {
        const topSimilarity = (similarMemories[0].similarity * 100).toFixed(1);
        this.addResult(testName, true, `Vector similarity search works (found ${similarMemories.length} results, top similarity: ${topSimilarity}%)`, startTime);
      } else {
        this.addResult(testName, false, 'Vector similarity search returned no results or missing similarity scores', startTime);
      }
    } catch (error) {
      this.addResult(testName, false, `Vector similarity test failed: ${error}`, startTime);
    }
  }

  private async testDatabaseService(): Promise<void> {
    const testName = 'DatabaseService Integration';
    const startTime = Date.now();
    
    if (!this.adapter) {
      this.addResult(testName, false, 'No database connection', startTime);
      return;
    }
    
    try {
      this.service = new DatabaseService(this.adapter);
      await this.service.initialize();
      
      // Test storing a development memory
      const memoryId = await this.service.storeDevMemory(
        'Testing DatabaseService integration with PostgreSQL adapter',
        'code',
        {
          key_decisions: ['Test service layer integration'],
          implementation_status: 'testing-integration',
          date: new Date().toISOString()
        }
      );
      
      // Test retrieving memories
      const memories = await this.service.getDevMemories();
      
      // Test similarity search through service
      const similar = await this.service.findSimilarMemories('DatabaseService integration test', 2);
      
      if (memoryId && memories.length > 0 && similar.length > 0) {
        this.addResult(testName, true, `DatabaseService integration successful (stored memory ${memoryId}, found ${memories.length} total memories, ${similar.length} similar)`, startTime);
      } else {
        this.addResult(testName, false, 'DatabaseService integration incomplete - some operations failed', startTime);
      }
    } catch (error) {
      this.addResult(testName, false, `DatabaseService integration failed: ${error}`, startTime);
    }
  }

  private async cleanup(): Promise<void> {
    if (this.service) {
      await this.service.disconnect();
    } else if (this.adapter) {
      await this.adapter.disconnect();
    }
  }

  private addResult(name: string, success: boolean, message: string, startTime: number): void {
    const duration = Date.now() - startTime;
    this.results.push({ name, success, message, duration });
    
    const status = success ? '✅' : '❌';
    const time = `(${duration}ms)`;
    console.error(`${status} ${name}: ${message} ${time}`);
  }

  private printSummary(): void {
    const successful = this.results.filter(r => r.success).length;
    const total = this.results.length;
    const failedTests = this.results.filter(r => !r.success);
    
    console.error(`\n📊 Test Summary: ${successful}/${total} tests passed`);
    
    if (failedTests.length > 0) {
      console.error('\n❌ Failed Tests:');
      failedTests.forEach(test => {
        console.error(`  - ${test.name}: ${test.message}`);
      });
    }
    
    if (successful === total) {
      console.error('\n🎉 All PostgreSQL tests passed! Ready for production use.');
    } else {
      console.error('\n⚠️  Some tests failed. Address issues before proceeding.');
    }
  }
}

async function main() {
  const tester = new PostgreSQLTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 PostgreSQL test suite failed:', error);
  process.exit(1);
});