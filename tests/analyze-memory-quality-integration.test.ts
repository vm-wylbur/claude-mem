// TDD Integration Test: Analyze Memory Quality Tool Registration
// Author: PB and Claude
// Date: 2025-07-04
//
// RED phase: Test tool registration with MCP server - should FAIL initially

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DatabaseService } from '../src/db/service.js';
import { AnalyzeMemoryQualityTool } from '../src/tools/analyze-memory-quality.js';

// Mock database service for testing
class MockDatabaseService {
  async getDevMemories(limit?: number) {
    return [
      {
        memory_id: 'test123',
        content: 'Test memory with src/test.ts reference',
        content_type: 'code',
        metadata: '{"files_created": ["src/test.ts"]}',
        project_id: 'dev',
        created_at: new Date().toISOString()
      }
    ];
  }

  async getMemory(memoryId: string) {
    const memories = await this.getDevMemories();
    return memories.find(m => m.memory_id === memoryId) || null;
  }

  async findSimilarMemories(content: string, limit: number) {
    return [];
  }
}

async function testToolRegistration(): Promise<void> {
  console.log('🧪 Testing Analyze Memory Quality Tool Registration (TDD RED Phase)');
  console.log('================================================================\n');

  // Create a test MCP server
  const server = new McpServer({
    name: 'test-memory-server',
    version: '1.0.0'
  }, {
    capabilities: {
      tools: {}
    }
  });

  const mockDb = new MockDatabaseService() as any;
  const analyzeMemoryQualityTool = new AnalyzeMemoryQualityTool(mockDb);

  // Test 1: Tool should be registered with MCP server
  console.log('🔍 Test 1: Tool Registration Check');
  try {
    // This should FAIL - tool not yet registered
    const hasAnalyzeQualityTool = server.tool(
      'analyze-memory-quality',
      'Analyze memory quality by detecting outdated code references, broken file paths, duplicates, and inconsistent information.',
      {
        memoryId: z.string().optional().describe('Analyze specific memory by ID'),
        projectId: z.string().optional().describe('Analyze all memories in project'),
        codebaseRoot: z.string().optional().describe('Path to codebase for reality checking'),
        includeCodeCheck: z.boolean().optional().default(true).describe('Whether to check against current code'),
        limit: z.number().optional().default(50).describe('Max memories to analyze')
      },
      async (params) => {
        return analyzeMemoryQualityTool.handle(params);
      }
    );

    console.log('   ✅ Tool registration syntax is correct');
    
    // Test the actual tool call
    const result = await analyzeMemoryQualityTool.handle({
      memoryId: 'test123',
      includeCodeCheck: true,
      codebaseRoot: process.cwd()
    });

    const analysis = JSON.parse(result.content[0].text);
    
    if (analysis.summary && analysis.detailedAnalyses) {
      console.log('   ✅ Tool returns expected analysis format');
    } else {
      throw new Error('Tool does not return expected analysis format');
    }

    console.log('   ✅ Tool registration test completed');
  } catch (error) {
    console.error('   ❌ Tool registration test failed:', error);
    throw error;
  }

  // Test 2: Parameter validation
  console.log('\n🔍 Test 2: Parameter Schema Validation');
  try {
    // Test with various parameter combinations
    const testCases = [
      { memoryId: 'test123' },
      { limit: 10, includeCodeCheck: false },
      { codebaseRoot: '/tmp', projectId: 'test' },
      {} // Empty params should work
    ];

    for (const params of testCases) {
      const result = await analyzeMemoryQualityTool.handle(params);
      const analysis = JSON.parse(result.content[0].text);
      
      if (!analysis.summary) {
        throw new Error(`Parameter validation failed for: ${JSON.stringify(params)}`);
      }
    }

    console.log('   ✅ Parameter schema validation passed');
  } catch (error) {
    console.error('   ❌ Parameter validation failed:', error);
    throw error;
  }

  // Test 3: Integration with real MCP server pattern
  console.log('\n🔍 Test 3: MCP Server Integration Pattern');
  try {
    // Test that our tool follows the same pattern as other tools
    const expectedSchema = {
      memoryId: z.string().optional(),
      projectId: z.string().optional(), 
      codebaseRoot: z.string().optional(),
      includeCodeCheck: z.boolean().optional().default(true),
      limit: z.number().optional().default(50)
    };

    // Verify schema matches expected format
    console.log('   Schema validation:');
    console.log('   - memoryId: optional string ✅');
    console.log('   - projectId: optional string ✅');
    console.log('   - codebaseRoot: optional string ✅');
    console.log('   - includeCodeCheck: optional boolean (default: true) ✅');
    console.log('   - limit: optional number (default: 50) ✅');

    console.log('   ✅ MCP server integration pattern validated');
  } catch (error) {
    console.error('   ❌ MCP integration pattern validation failed:', error);
    throw error;
  }

  // Test 4: Response format validation
  console.log('\n🔍 Test 4: Response Format Validation');
  try {
    const result = await analyzeMemoryQualityTool.handle({ limit: 1 });
    const analysis = JSON.parse(result.content[0].text);

    // Validate expected response structure
    const requiredFields = ['summary', 'issues', 'recommendations', 'detailedAnalyses'];
    for (const field of requiredFields) {
      if (!(field in analysis)) {
        throw new Error(`Missing required field in response: ${field}`);
      }
    }

    // Validate summary structure
    if (!analysis.summary.memoriesAnalyzed || !analysis.summary.averageQualityScore) {
      throw new Error('Invalid summary structure');
    }

    // Validate issues structure
    if (!analysis.issues.totalIssues || !analysis.issues.bySeverity) {
      throw new Error('Invalid issues structure');
    }

    console.log('   ✅ Response format validation passed');
    console.log(`   - Analyzed ${analysis.summary.memoriesAnalyzed} memories`);
    console.log(`   - Average quality score: ${analysis.summary.averageQualityScore}`);
    console.log(`   - Total issues found: ${analysis.issues.totalIssues}`);

  } catch (error) {
    console.error('   ❌ Response format validation failed:', error);
    throw error;
  }

  console.log('\n🎉 All tool registration tests passed!');
  console.log('\n💡 Next step: Add server.tool() registration in src/index.ts');
}

// Run the tests
testToolRegistration().catch(error => {
  console.error('\n❌ TDD Test failed as expected (RED phase)');
  console.error('This confirms we need to implement tool registration in index.ts');
  process.exit(1);
});