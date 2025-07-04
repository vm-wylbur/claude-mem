// Real MCP Protocol Integration Test
// Author: PB and Claude
// Date: 2025-07-04
//
// Tests actual MCP JSON-RPC protocol communication with analyze-memory-quality tool

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { Readable, Writable } from 'stream';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

class MCPClient {
  private server: ChildProcess;
  private responseQueue: Map<number, (response: MCPResponse) => void> = new Map();
  private requestId = 1;

  constructor(serverPath: string) {
    this.server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { 
        ...process.env, 
        NODE_ENV: 'test',
        MCPMEM_DB_TYPE: 'postgresql' // Use real DB for integration test
      }
    });

    // Parse responses from server
    let buffer = '';
    this.server.stdout!.on('data', (data) => {
      buffer += data.toString();
      
      // Split by newlines to handle multiple JSON messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response: MCPResponse = JSON.parse(line);
            const callback = this.responseQueue.get(response.id);
            if (callback) {
              this.responseQueue.delete(response.id);
              callback(response);
            }
          } catch (error) {
            console.error('Failed to parse MCP response:', line);
          }
        }
      }
    });

    this.server.stderr!.on('data', (data) => {
      const stderr = data.toString();
      // Filter out normal startup messages
      if (!stderr.includes('Memory MCP Server started') && 
          !stderr.includes('Configuration loaded') &&
          !stderr.includes('connection established')) {
        console.error('Server stderr:', stderr);
      }
    });
  }

  async sendRequest(method: string, params?: any): Promise<MCPResponse> {
    const id = this.requestId++;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseQueue.delete(id);
        reject(new Error(`MCP request timeout for method: ${method}`));
      }, 10000); // 10 second timeout

      this.responseQueue.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      const requestJson = JSON.stringify(request) + '\n';
      this.server.stdin!.write(requestJson);
    });
  }

  async waitForReady(): Promise<void> {
    // Wait for server to be ready by sending initialize request
    try {
      await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: false
          }
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      });
    } catch (error) {
      console.log('Initialize failed (expected for some MCP servers):', error);
    }
  }

  close(): void {
    this.server.kill('SIGTERM');
  }
}

async function testRealMCPProtocol(): Promise<void> {
  console.log('🧪 Real MCP Protocol Integration Test');
  console.log('====================================\n');

  const serverPath = path.join(process.cwd(), 'dist', 'index.js');
  const client = new MCPClient(serverPath);

  try {
    // Wait for server to be ready
    console.log('🚀 Starting MCP server...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Give server time to start
    
    // Test 1: List tools via MCP protocol
    console.log('🔍 Test 1: MCP tools/list Request');
    try {
      const listResponse = await client.sendRequest('tools/list');
      
      if (listResponse.error) {
        throw new Error(`tools/list failed: ${listResponse.error.message}`);
      }

      const tools = listResponse.result?.tools || [];
      console.log(`   Found ${tools.length} tools`);
      
      const analyzeQualityTool = tools.find((tool: any) => tool.name === 'analyze-memory-quality');
      
      if (analyzeQualityTool) {
        console.log('   ✅ analyze-memory-quality found in MCP tools/list');
        console.log(`   📋 Description: ${analyzeQualityTool.description}`);
        console.log(`   📝 Input Schema: ${analyzeQualityTool.inputSchema ? 'Present' : 'Missing'}`);
        
        // Validate schema structure
        if (analyzeQualityTool.inputSchema?.properties) {
          const props = analyzeQualityTool.inputSchema.properties;
          const expectedProps = ['memoryId', 'projectId', 'codebaseRoot', 'includeCodeCheck', 'limit'];
          
          for (const prop of expectedProps) {
            if (props[prop]) {
              console.log(`   📌 Parameter '${prop}': ✅`);
            } else {
              throw new Error(`Missing expected parameter: ${prop}`);
            }
          }
        }
      } else {
        throw new Error('analyze-memory-quality not found in tools/list response');
      }
    } catch (error) {
      console.error('   ❌ tools/list test failed:', error);
      throw error;
    }

    // Test 2: Call tool via MCP protocol
    console.log('\n🔍 Test 2: MCP tools/call Request');
    try {
      const callResponse = await client.sendRequest('tools/call', {
        name: 'analyze-memory-quality',
        arguments: {
          limit: 2,
          includeCodeCheck: false
        }
      });

      if (callResponse.error) {
        throw new Error(`tools/call failed: ${callResponse.error.message}`);
      }

      const result = callResponse.result;
      console.log('   ✅ MCP tools/call succeeded');
      
      // Validate response structure
      if (result?.content && Array.isArray(result.content)) {
        console.log(`   📄 Response content length: ${result.content.length}`);
        
        if (result.content[0]?.text) {
          const analysis = JSON.parse(result.content[0].text);
          
          if (analysis.summary && analysis.detailedAnalyses) {
            console.log('   ✅ Valid analysis response format');
            console.log(`   📊 Memories analyzed: ${analysis.summary.memoriesAnalyzed}`);
            console.log(`   🎯 Average quality score: ${analysis.summary.averageQualityScore}`);
            console.log(`   ⚠️  Total issues: ${analysis.issues.totalIssues}`);
          } else {
            throw new Error('Invalid analysis response structure');
          }
        } else {
          throw new Error('No text content in response');
        }
      } else {
        throw new Error('Invalid MCP response format');
      }
    } catch (error) {
      console.error('   ❌ tools/call test failed:', error);
      throw error;
    }

    // Test 3: Parameter validation via MCP
    console.log('\n🔍 Test 3: MCP Parameter Validation');
    try {
      // Test with specific memory ID
      const specificMemoryResponse = await client.sendRequest('tools/call', {
        name: 'analyze-memory-quality',
        arguments: {
          memoryId: 'nonexistent123'
        }
      });

      if (specificMemoryResponse.error) {
        console.log('   ⚠️  Expected error for nonexistent memory (this is okay)');
      } else {
        const result = JSON.parse(specificMemoryResponse.result.content[0].text);
        console.log('   ✅ Handled nonexistent memory gracefully');
      }

      // Test with invalid parameters
      const invalidParamsResponse = await client.sendRequest('tools/call', {
        name: 'analyze-memory-quality',
        arguments: {
          limit: "invalid" // Should be number
        }
      });

      if (invalidParamsResponse.error) {
        console.log('   ✅ Parameter validation working (rejected invalid limit)');
      } else {
        console.log('   ⚠️  Parameter validation may be too lenient');
      }

    } catch (error) {
      console.error('   ❌ Parameter validation test failed:', error);
      throw error;
    }

    // Test 4: Error handling via MCP
    console.log('\n🔍 Test 4: MCP Error Handling');
    try {
      // Test calling non-existent tool
      const nonExistentResponse = await client.sendRequest('tools/call', {
        name: 'non-existent-tool',
        arguments: {}
      });

      if (nonExistentResponse.error) {
        console.log('   ✅ Proper error handling for non-existent tool');
        console.log(`   📝 Error: ${nonExistentResponse.error.message}`);
      } else {
        throw new Error('Should have failed for non-existent tool');
      }
    } catch (error) {
      console.error('   ❌ Error handling test failed:', error);
      throw error;
    }

    console.log('\n🎉 All real MCP protocol tests passed!');
    console.log('✅ Tool is fully integrated with MCP JSON-RPC protocol');

  } finally {
    client.close();
  }
}

// Run the comprehensive test
testRealMCPProtocol().catch(error => {
  console.error('\n❌ Real MCP Protocol test failed');
  console.error('Details:', error.message);
  process.exit(1);
});