#!/usr/bin/env node

import { config } from 'dotenv';
import path from 'path';
import { initializeDatabase } from './dist/db/init.js';
import { DatabaseService } from './dist/db/service.js';

// Load environment variables
config();

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    // Initialize database
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'memory.db');
    
    try {
        const db = await initializeDatabase(dbPath);
        const dbService = new DatabaseService(db);
        
        switch (command) {
            case 'list':
                await listMemories(dbService, args[1]);
                break;
            case 'search':
                if (!args[1]) {
                    console.error('Usage: node agent-cli.js search "your query"');
                    process.exit(1);
                }
                await searchMemories(dbService, args[1]);
                break;
            case 'get':
                if (!args[1]) {
                    console.error('Usage: node agent-cli.js get <memory_id>');
                    process.exit(1);
                }
                await getMemory(dbService, parseInt(args[1]));
                break;
            case 'store':
                if (!args[1] || !args[2]) {
                    console.error('Usage: node agent-cli.js store "content" "type"');
                    console.error('Types: conversation, code, decision, reference');
                    process.exit(1);
                }
                await storeMemory(dbService, args[1], args[2]);
                break;
            case 'test':
                await runTests(dbService);
                break;
            default:
                showUsage();
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

async function listMemories(dbService, limitStr) {
    const limit = limitStr ? parseInt(limitStr) : 10;
    console.log(`📋 Listing ${limit} recent memories:\n`);
    
    const memories = dbService.getDevMemories();
    const limited = memories.slice(0, limit);
    
    limited.forEach((memory, i) => {
        console.log(`${i + 1}. [ID: ${memory.memory_id}] ${memory.content_type.toUpperCase()}`);
        console.log(`   Created: ${memory.created_at}`);
        console.log(`   Content: ${memory.content.substring(0, 120)}${memory.content.length > 120 ? '...' : ''}`);
        
        if (memory.metadata) {
            try {
                const meta = JSON.parse(memory.metadata);
                if (meta.implementation_status) {
                    console.log(`   Status: ${meta.implementation_status}`);
                }
                if (meta.key_decisions && meta.key_decisions.length > 0) {
                    console.log(`   Decisions: ${meta.key_decisions.slice(0, 2).join(', ')}${meta.key_decisions.length > 2 ? '...' : ''}`);
                }
            } catch (e) {
                // ignore parsing errors
            }
        }
        console.log();
    });
    
    console.log(`Total memories: ${memories.length}`);
}

async function searchMemories(dbService, query) {
    console.log(`🔍 Searching for: "${query}"\n`);
    
    const results = await dbService.findSimilarMemories(query, 5);
    
    if (results.length === 0) {
        console.log('No similar memories found.');
        return;
    }
    
    console.log(`Found ${results.length} similar memories:\n`);
    
    results.forEach((result, i) => {
        const similarity = ((result.similarity || 0) * 100).toFixed(1);
        console.log(`${i + 1}. [${similarity}% match] ID: ${result.memory_id}`);
        console.log(`   Type: ${result.content_type}`);
        console.log(`   Created: ${result.created_at}`);
        console.log(`   Content: ${result.content.substring(0, 150)}${result.content.length > 150 ? '...' : ''}`);
        
        if (result.metadata) {
            try {
                const meta = JSON.parse(result.metadata);
                if (meta.implementation_status) {
                    console.log(`   Status: ${meta.implementation_status}`);
                }
            } catch (e) {
                // ignore
            }
        }
        console.log();
    });
}

async function getMemory(dbService, memoryId) {
    console.log(`📄 Getting memory ID: ${memoryId}\n`);
    
    const memory = dbService.getMemory(memoryId);
    
    if (!memory) {
        console.log(`Memory with ID ${memoryId} not found.`);
        return;
    }
    
    console.log(`ID: ${memory.memory_id}`);
    console.log(`Type: ${memory.content_type}`);
    console.log(`Created: ${memory.created_at}`);
    console.log(`Content:\n${memory.content}\n`);
    
    if (memory.metadata) {
        try {
            const meta = JSON.parse(memory.metadata);
            console.log('Metadata:');
            console.log(JSON.stringify(meta, null, 2));
        } catch (e) {
            console.log('Raw metadata:', memory.metadata);
        }
    }
}

async function storeMemory(dbService, content, type) {
    console.log(`💾 Storing new memory...\n`);
    
    const validTypes = ['conversation', 'code', 'decision', 'reference'];
    if (!validTypes.includes(type)) {
        console.error(`Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
    }
    
    const metadata = {
        date: new Date().toISOString(),
        source: 'agent-mode-cli',
        stored_by: 'Agent Mode via CLI'
    };
    
    const memoryId = await dbService.storeDevMemory(content, type, metadata);
    console.log(`✅ Successfully stored memory with ID: ${memoryId}`);
    
    // Verify it was stored
    const stored = dbService.getMemory(memoryId);
    if (stored) {
        console.log(`✅ Verified: "${stored.content.substring(0, 50)}..."`);
    }
}

async function runTests(dbService) {
    console.log('🧪 Running memory service tests...\n');
    
    // Test 1: List recent memories
    console.log('1. Testing memory listing...');
    const memories = dbService.getDevMemories();
    console.log(`   ✅ Found ${memories.length} memories`);
    
    // Test 2: Test search functionality
    console.log('2. Testing semantic search...');
    const searchResults = await dbService.findSimilarMemories('entity extraction PH-ICC', 3);
    console.log(`   ✅ Search returned ${searchResults.length} results`);
    
    if (searchResults.length > 0) {
        const topResult = searchResults[0];
        const similarity = ((topResult.similarity || 0) * 100).toFixed(1);
        console.log(`   Top result: ${similarity}% match - "${topResult.content.substring(0, 60)}..."`);
    }
    
    // Test 3: Store and retrieve
    console.log('3. Testing store and retrieve...');
    const testContent = `CLI test memory stored at ${new Date().toISOString()}`;
    const newId = await dbService.storeDevMemory(testContent, 'reference', {
        date: new Date().toISOString(),
        test: true,
        source: 'cli-test'
    });
    console.log(`   ✅ Stored test memory with ID: ${newId}`);
    
    const retrieved = dbService.getMemory(newId);
    if (retrieved && retrieved.content === testContent) {
        console.log(`   ✅ Successfully retrieved test memory`);
    } else {
        console.log(`   ❌ Failed to retrieve test memory`);
    }
    
    console.log('\n🎉 All tests completed!');
}

function showUsage() {
    console.log(`
Memory Server CLI - Agent Mode Interface

Usage:
  node agent-cli.js <command> [arguments]

Commands:
  list [limit]           List recent memories (default: 10)
  search "query"         Semantic search for similar memories
  get <memory_id>        Get specific memory by ID
  store "content" "type" Store new memory (types: conversation, code, decision, reference)
  test                   Run functionality tests

Examples:
  node agent-cli.js list 5
  node agent-cli.js search "entity extraction"
  node agent-cli.js get 28
  node agent-cli.js store "Testing CLI access" "reference"
  node agent-cli.js test
`);
}

main().catch(console.error);
