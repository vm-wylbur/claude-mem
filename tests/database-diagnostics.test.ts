// TDD Test: Database Diagnostics Interface Compliance
// Author: PB and Claude  
// Date: 2025-07-04
//
// RED phase: Test should FAIL because SQLiteAdapter doesn't implement getDatabaseInfo()

import { SqliteAdapter } from '../src/db/adapters/sqlite.js';
import { PostgresAdapter } from '../src/db/adapters/postgres.js';
import { DatabaseConnectionInfo } from '../src/db/adapters/base.js';

async function testDatabaseAdapterCompliance(): Promise<void> {
  console.log('🧪 Testing Database Adapter Interface Compliance');
  console.log('================================================\n');

  // Test 1: PostgresAdapter should have getDatabaseInfo
  console.log('🔍 Test 1: PostgresAdapter getDatabaseInfo method');
  try {
    const pgConfig = {
      type: 'postgresql' as const,
      postgresql: {
        hosts: ['localhost'],
        database: 'test',
        user: 'test',
        password: 'test',
        port: 5432
      }
    };
    
    const pgAdapter = new PostgresAdapter(pgConfig);
    
    // Check if method exists
    if (typeof pgAdapter.getDatabaseInfo === 'function') {
      console.log('   ✅ PostgresAdapter has getDatabaseInfo method');
    } else {
      throw new Error('PostgresAdapter missing getDatabaseInfo method');
    }
  } catch (error) {
    console.error('   ❌ PostgresAdapter test failed:', error);
    throw error;
  }

  // Test 2: SqliteAdapter should have getDatabaseInfo (THIS SHOULD FAIL)
  console.log('\n🔍 Test 2: SqliteAdapter getDatabaseInfo method');
  try {
    const sqliteConfig = {
      type: 'sqlite' as const,
      sqlite: {
        path: './test.db'
      }
    };
    
    const sqliteAdapter = new SqliteAdapter(sqliteConfig);
    
    // Check if method exists - THIS SHOULD FAIL
    if (typeof sqliteAdapter.getDatabaseInfo === 'function') {
      console.log('   ✅ SqliteAdapter has getDatabaseInfo method');
      
      // Test method signature without connecting to database
      const info = await sqliteAdapter.getDatabaseInfo();
      
      if (info.type === 'sqlite' && info.database && info.lastHealthCheck) {
        console.log('   ✅ SqliteAdapter returns valid DatabaseConnectionInfo');
      } else {
        throw new Error('SqliteAdapter getDatabaseInfo returns invalid format');
      }
    } else {
      throw new Error('SqliteAdapter missing getDatabaseInfo method');
    }
  } catch (error) {
    console.error('   ❌ SqliteAdapter test failed:', error);
    console.error('\n💡 This is expected in RED phase - SqliteAdapter needs getDatabaseInfo implementation!');
    throw error;
  }

  console.log('\n🎉 All database adapters implement required diagnostic interface!');
}

// Test 3: Compilation test
async function testCompilation(): Promise<void> {
  console.log('\n🔍 Test 3: TypeScript Compilation Check');
  
  // This should fail to compile if interfaces don't match
  const configs = [
    {
      type: 'postgresql' as const,
      postgresql: {
        hosts: ['localhost'],
        database: 'test', 
        user: 'test'
      }
    },
    {
      type: 'sqlite' as const,
      sqlite: {
        path: './test.db'
      }
    }
  ];
  
  // Both adapters should satisfy DatabaseAdapter interface
  for (const config of configs) {
    if (config.type === 'postgresql') {
      const adapter = new PostgresAdapter(config);
      // TypeScript should enforce that getDatabaseInfo exists
      const info = adapter.getDatabaseInfo; // This should compile
      console.log('   ✅ PostgresAdapter satisfies DatabaseAdapter interface');
    } else if (config.type === 'sqlite') {
      const adapter = new SqliteAdapter(config);
      // TypeScript should enforce that getDatabaseInfo exists - THIS SHOULD FAIL TO COMPILE
      const info = adapter.getDatabaseInfo; // This should fail to compile
      console.log('   ✅ SqliteAdapter satisfies DatabaseAdapter interface');
    }
  }
}

// Run the tests
testDatabaseAdapterCompliance()
  .then(() => testCompilation())
  .then(() => {
    console.log('\n🎉 All tests passed!');
  })
  .catch(error => {
    console.error('\n❌ TDD Test failed as expected (RED phase)');
    console.error('Next step: Implement getDatabaseInfo() in SqliteAdapter');
    process.exit(1);
  });