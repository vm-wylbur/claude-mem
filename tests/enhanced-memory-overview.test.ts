// TDD Test: Enhanced Memory Overview with Real Diagnostics
// Author: PB and Claude
// Date: 2025-07-04
//
// RED phase: Test should FAIL initially due to missing diagnostic features

import { MemoryOverviewTool } from '../src/tools/memory-overview.js';

interface MockDatabaseConnectionInfo {
  type: 'postgresql';
  host: string;
  port: number;
  database: string;
  isConnected: boolean;
  postgresVersion: string;
  pgvectorVersion: string;
  connectionPool: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingClients: number;
  };
  lastHealthCheck: Date;
}

interface MockConfigurationInfo {
  source: 'toml';
  configPath: string;
  overrides: string[];
}

interface MockOllamaHealth {
  connected: boolean;
  host: string;
  model: string;
  lastEmbeddingTest: Date;
  error?: string;
}

class MockDatabaseService {
  async getDevMemories(limit?: number) {
    return [
      {
        memory_id: 'test123',
        content: 'Test memory content',
        content_type: 'code',
        metadata: '{"implementation_status": "completed"}',
        created_at: '2025-07-04T16:00:00.000Z'
      }
    ];
  }

  async getDatabaseInfo(): Promise<MockDatabaseConnectionInfo> {
    return {
      type: 'postgresql',
      host: 'pg-2c908149-claude-mem.e.aivencloud.com',
      port: 24030,
      database: 'defaultdb',
      isConnected: true,
      postgresVersion: '15.4',
      pgvectorVersion: '0.5.1',
      connectionPool: {
        totalConnections: 5,
        activeConnections: 2,
        idleConnections: 3,
        waitingClients: 0
      },
      lastHealthCheck: new Date('2025-07-04T16:42:00.000Z')
    };
  }
}

// Test the enhanced memory overview
async function testEnhancedMemoryOverview(): Promise<void> {
  console.log('🧪 Testing Enhanced Memory Overview with Real Diagnostics');
  console.log('========================================================\n');

  try {
    const mockDb = new MockDatabaseService() as any;
    const tool = new MemoryOverviewTool(mockDb);
    
    const result = await tool.handle();
    
    // Parse the JSON response
    const overview = JSON.parse(result.content[0].text);
    
    console.log('✅ Tool executed successfully');
    
    // Test 1: Should have real database connection info
    console.log('\n🔍 Test 1: Database Connection Info');
    if (overview['🔗 Database Connection (LIVE)']) {
      const dbInfo = overview['🔗 Database Connection (LIVE)'];
      
      console.log(`   Database Type: ${dbInfo.type}`);
      console.log(`   Host: ${dbInfo.host}`);
      console.log(`   Status: ${dbInfo.status}`);
      console.log(`   PostgreSQL Version: ${dbInfo.postgres_version}`);
      console.log(`   pgvector Version: ${dbInfo.pgvector_version}`);
      
      if (dbInfo.connection_pool) {
        console.log(`   Pool - Total: ${dbInfo.connection_pool.total}, Active: ${dbInfo.connection_pool.active}`);
      }
      
      // Assertions
      if (dbInfo.type === 'postgresql' && 
          dbInfo.host === 'pg-2c908149-claude-mem.e.aivencloud.com' &&
          dbInfo.status === '🟢 Connected') {
        console.log('   ✅ Database connection info is correct');
      } else {
        throw new Error('Database connection info is missing or incorrect');
      }
    } else {
      throw new Error('Database Connection (LIVE) section missing');
    }
    
    // Test 2: Should have configuration info
    console.log('\n🔍 Test 2: Configuration Info');
    if (overview['⚙️ Configuration']) {
      const configInfo = overview['⚙️ Configuration'];
      console.log(`   Source: ${configInfo.source}`);
      console.log(`   Config File: ${configInfo.config_file}`);
      console.log(`   Env Overrides: ${configInfo.env_overrides}`);
      console.log('   ✅ Configuration info present');
    } else {
      throw new Error('Configuration section missing');
    }
    
    // Test 3: Should have Ollama health check
    console.log('\n🔍 Test 3: Ollama Health Info');
    if (overview['🤖 Ollama Service']) {
      const ollamaInfo = overview['🤖 Ollama Service'];
      console.log(`   Status: ${ollamaInfo.status}`);
      console.log(`   Host: ${ollamaInfo.host}`);
      console.log(`   Model: ${ollamaInfo.model}`);
      console.log('   ✅ Ollama health info present');
    } else {
      throw new Error('Ollama Service section missing');
    }
    
    // Test 4: Should NOT have hardcoded "SSH tunnel" references
    console.log('\n🔍 Test 4: No Hardcoded Connection References');
    const responseText = result.content[0].text;
    if (responseText.includes('SSH tunnel to snowl/snowball')) {
      throw new Error('Found hardcoded SSH tunnel reference - should show real connection info');
    } else {
      console.log('   ✅ No hardcoded connection references found');
    }
    
    console.log('\n🎉 All tests passed! Enhanced memory overview working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('\n💡 This is expected in RED phase - now implement the features!');
    process.exit(1);
  }
}

// Run the test
testEnhancedMemoryOverview().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});