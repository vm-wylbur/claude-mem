#!/usr/bin/env npx tsx
// TDD Contract Tests for Database Tag Constraints
// These tests examine the exact database schema constraints for tags

import { initializeHasher } from '../src/utils/hash.js';
import { getDatabaseConfigToml } from '../src/config-toml.js';
import { PostgresAdapter } from '../src/db/adapters/postgres.js';
import { DatabaseService } from '../src/db/service.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface SchemaInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  table_name: string;
  column_names: string[];
}

class TagConstraintContractTester {
  private adapter: PostgresAdapter | null = null;
  private service: DatabaseService | null = null;
  private results: TestResult[] = [];
  private testMemoryIds: string[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Database Tag Constraint Contract Tests (TDD)');
    console.error('===============================================\n');

    try {
      await this.setup();
      
      // Test 1: Examine current database schema
      await this.testDatabaseSchema();
      
      // Test 2: Test constraint violations directly
      await this.testConstraintViolations();
      
      // Test 3: Test ON CONFLICT expectations vs reality
      await this.testOnConflictExpectations();
      
      // Test 4: Test tag ID format consistency
      await this.testTagIdFormats();
      
      await this.cleanup();
      this.printResults();
      
    } catch (error) {
      console.error('💥 Tag constraint test setup failed:', error);
      process.exit(1);
    }
  }

  private async setup(): Promise<void> {
    console.error('🔧 Setting up tag constraint test environment...');
    
    await initializeHasher();
    
    const config = await getDatabaseConfigToml();
    
    if (config.type !== 'postgresql') {
      throw new Error('Tag constraint tests require PostgreSQL configuration');
    }
    
    this.adapter = new PostgresAdapter(config);
    await this.adapter.connect();
    this.service = new DatabaseService(this.adapter);
    await this.service.initialize();
    
    console.error('✅ Tag constraint test environment ready\n');
  }

  private async cleanup(): Promise<void> {
    if (this.testMemoryIds.length > 0) {
      console.error(`🧹 Cleaning up ${this.testMemoryIds.length} test memories...`);
    }
    
    if (this.adapter) {
      await this.adapter.disconnect();
    }
  }

  private async getSchemaInfo(tableName: string): Promise<SchemaInfo[]> {
    if (!this.adapter || !(this.adapter as any).pool) {
      throw new Error('Database adapter not properly initialized');
    }
    
    const pool = (this.adapter as any).pool;
    
    const result = await pool.query(`
      SELECT 
        table_name,
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
    
    return result.rows;
  }

  private async getConstraintInfo(tableName: string): Promise<ConstraintInfo[]> {
    if (!this.adapter || !(this.adapter as any).pool) {
      throw new Error('Database adapter not properly initialized');
    }
    
    const pool = (this.adapter as any).pool;
    
    const result = await pool.query(`
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        tc.table_name,
        array_agg(kcu.column_name ORDER BY kcu.ordinal_position) as column_names
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = $1
      GROUP BY tc.constraint_name, tc.constraint_type, tc.table_name
      ORDER BY tc.constraint_type, tc.constraint_name
    `, [tableName]);
    
    return result.rows;
  }

  private async testDatabaseSchema(): Promise<void> {
    console.error('📋 Testing current database schema...');
    
    const tests = [
      {
        name: 'Tags table schema examination',
        test: async () => {
          const schema = await this.getSchemaInfo('tags');
          const constraints = await this.getConstraintInfo('tags');
          
          console.error('\n  🏷️  TAGS table schema:');
          schema.forEach(col => {
            console.error(`    ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
          });
          
          console.error('\n  🔒 TAGS table constraints:');
          constraints.forEach(constraint => {
            console.error(`    ${constraint.constraint_name}: ${constraint.constraint_type} (${constraint.column_names.join(', ')})`);
          });
          
          // Check if required constraints exist
          const hasNameUnique = constraints.some(c => 
            c.constraint_type === 'UNIQUE' && c.column_names.includes('name')
          );
          
          if (!hasNameUnique) {
            throw new Error('Missing UNIQUE constraint on tags.name - required for ON CONFLICT (name)');
          }
        }
      },
      {
        name: 'Memory_tags table schema examination',
        test: async () => {
          const schema = await this.getSchemaInfo('memory_tags');
          const constraints = await this.getConstraintInfo('memory_tags');
          
          console.error('\n  🔗 MEMORY_TAGS table schema:');
          schema.forEach(col => {
            console.error(`    ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
          });
          
          console.error('\n  🔒 MEMORY_TAGS table constraints:');
          constraints.forEach(constraint => {
            console.error(`    ${constraint.constraint_name}: ${constraint.constraint_type} (${constraint.column_names.join(', ')})`);
          });
          
          // Check if required constraints exist
          const hasPrimaryKey = constraints.some(c => 
            c.constraint_type === 'PRIMARY KEY' && 
            c.column_names.includes('memory_id') && 
            c.column_names.includes('tag_id')
          );
          
          if (!hasPrimaryKey) {
            throw new Error('Missing PRIMARY KEY constraint on (memory_id, tag_id) - required for ON CONFLICT (memory_id, tag_id)');
          }
        }
      }
    ];

    for (const { name, test } of tests) {
      try {
        await test();
        this.results.push({ name, passed: true });
      } catch (error) {
        this.results.push({ 
          name, 
          passed: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async testConstraintViolations(): Promise<void> {
    console.error('📋 Testing constraint violations directly...');
    
    const tests = [
      {
        name: 'Direct tag insertion with ON CONFLICT',
        test: async () => {
          if (!this.adapter || !(this.adapter as any).pool) {
            throw new Error('Database adapter not properly initialized');
          }
          
          const pool = (this.adapter as any).pool;
          
          // Try the exact SQL that's failing
          const testTagName = 'TEST-DB-CONSTRAINTS-tag';
          const testTagId = 'test123'; // Use string since we're using hex format
          
          console.error(`\n  Attempting: INSERT INTO tags (tag_id, name) VALUES ('${testTagId}', '${testTagName}') ON CONFLICT (name) DO NOTHING`);
          
          try {
            await pool.query(`
              INSERT INTO tags (tag_id, name) VALUES ($1, $2)
              ON CONFLICT (name) DO NOTHING
            `, [testTagId, testTagName]);
            
            console.error(`    ✅ Tag insertion with ON CONFLICT succeeded`);
            
          } catch (error) {
            console.error(`    ❌ Tag insertion failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          }
        }
      },
      {
        name: 'Direct memory_tags insertion with ON CONFLICT',
        test: async () => {
          if (!this.adapter || !(this.adapter as any).pool) {
            throw new Error('Database adapter not properly initialized');
          }
          
          const pool = (this.adapter as any).pool;
          
          // First create a test memory
          const testContent = 'TEST-DB-CONSTRAINTS: Direct constraint test';
          if (!this.service) throw new Error('Service not initialized');
          
          const memoryId = await this.service.storeDevMemory(
            testContent,
            'code',
            { status: 'test', date: new Date().toISOString() }
          );
          
          this.testMemoryIds.push(memoryId);
          
          // Try the exact SQL that's failing
          const testTagId = 'test456';
          
          console.error(`\n  Attempting: INSERT INTO memory_tags (memory_id, tag_id) VALUES ('${memoryId}', '${testTagId}') ON CONFLICT (memory_id, tag_id) DO NOTHING`);
          
          try {
            await pool.query(`
              INSERT INTO memory_tags (memory_id, tag_id)
              VALUES ($1, $2)
              ON CONFLICT (memory_id, tag_id) DO NOTHING
            `, [memoryId, testTagId]);
            
            console.error(`    ✅ Memory_tags insertion with ON CONFLICT succeeded`);
            
          } catch (error) {
            console.error(`    ❌ Memory_tags insertion failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          }
        }
      }
    ];

    for (const { name, test } of tests) {
      try {
        await test();
        this.results.push({ name, passed: true });
      } catch (error) {
        this.results.push({ 
          name, 
          passed: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async testOnConflictExpectations(): Promise<void> {
    console.error('📋 Testing ON CONFLICT expectations vs PostgreSQL adapter code...');
    
    const tests = [
      {
        name: 'ON CONFLICT clauses match actual constraints',
        test: async () => {
          // Check what the PostgreSQL adapter code expects vs what exists
          const tagsConstraints = await this.getConstraintInfo('tags');
          const memoryTagsConstraints = await this.getConstraintInfo('memory_tags');
          
          console.error('\n  🔍 Expected by code:');
          console.error('    - tags table: ON CONFLICT (name) - requires UNIQUE constraint on name');
          console.error('    - memory_tags table: ON CONFLICT (memory_id, tag_id) - requires constraint on (memory_id, tag_id)');
          
          console.error('\n  🔍 Actually exists:');
          console.error('    TAGS constraints:');
          tagsConstraints.forEach(c => {
            console.error(`      ${c.constraint_type}: ${c.column_names.join(', ')}`);
          });
          
          console.error('    MEMORY_TAGS constraints:');
          memoryTagsConstraints.forEach(c => {
            console.error(`      ${c.constraint_type}: ${c.column_names.join(', ')}`);
          });
          
          // Verify specific constraints
          const tagsNameUnique = tagsConstraints.find(c => 
            c.constraint_type === 'UNIQUE' && c.column_names.includes('name')
          );
          
          const memoryTagsPK = memoryTagsConstraints.find(c => 
            c.constraint_type === 'PRIMARY KEY' && 
            c.column_names.includes('memory_id') && 
            c.column_names.includes('tag_id')
          );
          
          if (!tagsNameUnique) {
            throw new Error('Missing: UNIQUE constraint on tags.name');
          }
          
          if (!memoryTagsPK) {
            throw new Error('Missing: PRIMARY KEY constraint on memory_tags(memory_id, tag_id)');
          }
          
          console.error('\n  ✅ All required constraints exist');
        }
      }
    ];

    for (const { name, test } of tests) {
      try {
        await test();
        this.results.push({ name, passed: true });
      } catch (error) {
        this.results.push({ 
          name, 
          passed: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async testTagIdFormats(): Promise<void> {
    console.error('📋 Testing tag ID format consistency...');
    
    const tests = [
      {
        name: 'Tag ID format matches memory ID format',
        test: async () => {
          if (!this.adapter || !(this.adapter as any).pool) {
            throw new Error('Database adapter not properly initialized');
          }
          
          const pool = (this.adapter as any).pool;
          
          // Check existing tag IDs format
          const existingTags = await pool.query('SELECT tag_id, name FROM tags LIMIT 5');
          
          console.error('\n  📊 Existing tag ID formats:');
          existingTags.rows.forEach((row: any) => {
            console.error(`    ${row.name}: "${row.tag_id}" (${typeof row.tag_id}, length: ${row.tag_id?.length})`);
          });
          
          // Check existing memory IDs format  
          const existingMemories = await pool.query('SELECT memory_id FROM memories LIMIT 5');
          
          console.error('\n  📊 Existing memory ID formats:');
          existingMemories.rows.forEach((row: any) => {
            console.error(`    "${row.memory_id}" (${typeof row.memory_id}, length: ${row.memory_id?.length})`);
          });
          
          // Check if formats are consistent
          if (existingTags.rows.length > 0 && existingMemories.rows.length > 0) {
            const tagIdType = typeof existingTags.rows[0].tag_id;
            const memoryIdType = typeof existingMemories.rows[0].memory_id;
            
            if (tagIdType !== memoryIdType) {
              throw new Error(`ID format mismatch: tag_id is ${tagIdType}, memory_id is ${memoryIdType}`);
            }
          }
        }
      }
    ];

    for (const { name, test } of tests) {
      try {
        await test();
        this.results.push({ name, passed: true });
      } catch (error) {
        this.results.push({ 
          name, 
          passed: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private printResults(): void {
    console.error('\n📊 Database Tag Constraint Contract Test Results:');
    console.error('================================================');
    
    let passed = 0;
    let total = this.results.length;
    
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.error(`${status} ${result.name}`);
      if (!result.passed && result.error) {
        console.error(`   Error: ${result.error}`);
      }
      if (result.passed) passed++;
    });
    
    console.error(`\n📈 Contract Test Summary: ${passed}/${total} tests passed`);
    
    console.error('\n🔍 Database Constraint Analysis:');
    console.error('- Schema examination reveals actual constraint structure');
    console.error('- ON CONFLICT clauses must match existing constraints exactly');
    console.error('- Tag ID format consistency with memory ID format required');
    
    if (this.testMemoryIds.length > 0) {
      console.error(`\n🧹 Test cleanup: ${this.testMemoryIds.length} test memories created`);
      console.error('💡 To clean up: DELETE FROM memories WHERE content LIKE \'TEST-DB-CONSTRAINTS:%\'');
    }
    
    if (passed === total) {
      console.error('\n🎉 All database constraint tests passed!');
      console.error('✅ Database schema constraints are properly configured');
      process.exit(0);
    } else {
      console.error('\n❌ Database constraint issues detected');
      console.error('🔧 Fix database schema to match ON CONFLICT expectations');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new TagConstraintContractTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Database constraint tests failed to run:', error);
  process.exit(1);
});