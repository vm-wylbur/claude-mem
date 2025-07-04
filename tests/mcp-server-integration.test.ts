// TDD Integration Test: MCP Server Tool Registration
// Author: PB and Claude  
// Date: 2025-07-04
//
// RED phase: Test that analyze-memory-quality tool is actually registered with MCP server

import { spawn } from 'child_process';
import * as path from 'path';

async function testMCPServerIntegration(): Promise<void> {
  console.log('🧪 Testing MCP Server Tool Registration (RED Phase)');
  console.log('================================================\n');

  // Test 1: Check if analyze-memory-quality tool is in server capabilities
  console.log('🔍 Test 1: Tool Listed in Server Capabilities');
  
  try {
    // Start the MCP server and check capabilities
    const serverPath = path.join(process.cwd(), 'dist', 'index.js');
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';
    let stderr = '';

    server.stdout.on('data', (data) => {
      output += data.toString();
    });

    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Send list_tools request
    const listToolsRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    };

    server.stdin.write(JSON.stringify(listToolsRequest) + '\n');

    // Wait for response
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.kill();
        reject(new Error('Server response timeout'));
      }, 5000);

      server.stdout.on('data', (data) => {
        const response = data.toString();
        if (response.includes('tools')) {
          clearTimeout(timeout);
          resolve(response);
        }
      });

      server.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    server.kill();

    // Check if our tool is in the response
    if (output.includes('analyze-memory-quality')) {
      console.log('   ✅ analyze-memory-quality tool found in server capabilities');
    } else {
      console.log('   ❌ analyze-memory-quality tool NOT found in server capabilities');
      console.log('   📝 Available tools:', output);
      throw new Error('Tool not registered with MCP server');
    }

  } catch (error) {
    console.error('   ❌ MCP Server integration test failed:', error);
    throw error;
  }

  console.log('\n🎉 MCP Server integration test completed!');
}

// Alternative simpler test - check if tool is mentioned in built index.js
async function testToolInBuiltServer(): Promise<void> {
  console.log('\n🔍 Test 2: Tool Registration in Built Server Code');
  
  try {
    const fs = await import('fs');
    const indexPath = path.join(process.cwd(), 'dist', 'index.js');
    
    if (!fs.existsSync(indexPath)) {
      throw new Error('Built server not found. Run npm run build first.');
    }
    
    const serverCode = fs.readFileSync(indexPath, 'utf8');
    
    if (serverCode.includes('analyze-memory-quality')) {
      console.log('   ✅ analyze-memory-quality found in built server code');
    } else {
      console.log('   ❌ analyze-memory-quality NOT found in built server code');
      console.log('   💡 This confirms tool registration is missing');
      throw new Error('Tool registration missing from built server');
    }
    
  } catch (error) {
    console.error('   ❌ Built server check failed:', error);
    throw error;
  }
}

// Test 3: Check source code for tool registration
async function testSourceCodeRegistration(): Promise<void> {
  console.log('\n🔍 Test 3: Tool Registration in Source Code');
  
  try {
    const fs = await import('fs');
    const indexPath = path.join(process.cwd(), 'src', 'index.ts');
    const sourceCode = fs.readFileSync(indexPath, 'utf8');
    
    // Check for server.tool call with our tool name
    const hasToolRegistration = sourceCode.includes("server.tool(") && 
                               sourceCode.includes("'analyze-memory-quality'");
    
    if (hasToolRegistration) {
      console.log('   ✅ analyze-memory-quality tool registration found in source');
    } else {
      console.log('   ❌ analyze-memory-quality tool registration NOT found in source');
      console.log('   💡 Need to add server.tool() call for analyze-memory-quality');
      throw new Error('Tool registration missing from source code');
    }
    
  } catch (error) {
    console.error('   ❌ Source code check failed:', error);
    throw error;
  }
}

// Run all tests
async function runAllTests(): Promise<void> {
  try {
    await testSourceCodeRegistration();
    await testToolInBuiltServer();
    await testMCPServerIntegration();
    
    console.log('\n🎉 All MCP integration tests passed!');
    console.log('✅ Tool is properly registered with MCP server');
    
  } catch (error) {
    console.error('\n❌ TDD Integration test failed as expected (RED phase)');
    console.error('📝 Next step: Add server.tool() registration in src/index.ts');
    console.error('Details:', error.message);
    process.exit(1);
  }
}

runAllTests();