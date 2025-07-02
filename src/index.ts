import { config } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DatabaseService, MemoryType } from './db/service.js';
import { createDatabaseAdapter, createDatabaseAdapterToml, getConfigSummary } from './config.js';
import { getConfigSummaryToml } from './config-toml.js';
import { storeDevProgress, storeInitialProgress } from './dev-memory.js';
import { formatHashForDisplay, parseHexToHash, isValidHashId } from './utils/hash.js';

// Load environment variables
config();

// Initialize database adapter based on TOML configuration
console.error(`🚀 Starting Memory MCP Server`);
console.error(`📊 Configuration loaded`);
console.error(`📋 ${getConfigSummaryToml()}`);

const adapter = await createDatabaseAdapterToml();
const dbService = new DatabaseService(adapter);
await dbService.initialize();

// Store initial development progress (skip if we already have memories)
const existingMemories = await dbService.getDevMemories();
if (existingMemories.length === 0) {
  console.error('📝 Storing initial development progress...');
  await storeInitialProgress(dbService);
} else {
  console.error(`📚 Found ${existingMemories.length} existing memories - skipping initial setup`);
}

// Create MCP Server with proper initialization
const server = new McpServer({
    name: 'agent-memory',
    version: '1.0.0',
    capabilities: {
        tools: {
            'memory-overview': true,
            'store-dev-memory': true,
            'list-dev-memories': true,
            'get-dev-memory': true,
            'search': true
        }
    }
});

// Add comprehensive overview tool - the go-to starting point for new Claude sessions
server.tool(
    'memory-overview',
    'Get a comprehensive overview of the memory system: recent memories, capabilities, statistics, and usage examples. Start here!',
    {},
    async () => {
        try {
            // Get basic statistics
            const recentMemories = await dbService.getDevMemories(5);
            const totalMemories = await dbService.getDevMemories(); // Get total count
            
            // Build comprehensive overview
            const overview = {
                "🧠 Memory System Overview": {
                    "database": "PostgreSQL with pgvector for semantic search",
                    "total_memories": totalMemories.length,
                    "connection": "SSH tunnel to snowl/snowball",
                    "id_system": "Hash-based IDs (64-bit) for distributed uniqueness"
                },
                
                "🛠️ Available Tools": {
                    "memory-overview": "📊 This tool - comprehensive system overview",
                    "search": "🔍 AI-powered semantic search using pgvector embeddings",
                    "store-dev-memory": "💾 Store new memories with metadata and tags",
                    "list-dev-memories": "📋 List recent memories with pagination",
                    "get-dev-memory": "🎯 Retrieve specific memory by hash ID"
                },
                
                "🔍 Quick Start Examples": {
                    "search_for_bugs": `search with "bug fixes" or "error handling"`,
                    "search_for_features": `search with "new feature" or "implementation"`,
                    "get_recent": `list-dev-memories with limit=5`,
                    "store_progress": `store-dev-memory with type="code" for implementations`
                },
                
                "📊 Memory Types Available": {
                    "conversation": "Discussions, decisions, planning sessions",
                    "code": "Implementation details, technical solutions",
                    "decision": "Important choices and their rationale",
                    "reference": "Documentation, links, external resources"
                },
                
                "🏷️ Recent Memories Preview": recentMemories.map(memory => {
                    const metadata = typeof memory.metadata === 'string' 
                        ? JSON.parse(memory.metadata) 
                        : memory.metadata;
                    return {
                        id: formatHashForDisplay(memory.memory_id),
                        type: memory.content_type,
                        preview: memory.content.substring(0, 100) + (memory.content.length > 100 ? '...' : ''),
                        status: metadata?.implementation_status || 'N/A',
                        created: memory.created_at
                    };
                }),
                
                "💡 Pro Tips": [
                    "Use 'search' first to find relevant existing memories",
                    "Hash IDs are shown in hex format - copy/paste them exactly",
                    "The 'limit' parameter in list-dev-memories improves performance",
                    "All memories are searchable via AI semantic similarity",
                    "Tag support is available for better organization"
                ]
            };
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(overview, null, 2)
                }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Error generating overview: ${error}`
                }]
            };
        }
    }
);

// Add tool to store development progress
server.tool(
    'store-dev-memory',
    'Store a new development memory with content, decisions, and code changes. Supports semantic search via pgvector.',
    {
        content: z.string().describe('The main content of the memory - what you want to remember'),
        type: z.enum(['conversation', 'code', 'decision', 'reference']).describe('Type: conversation (discussions), code (implementation), decision (choices made), reference (documentation)'),
        keyDecisions: z.array(z.string()).optional().describe('Important decisions made during this work'),
        status: z.string().optional().describe('Current implementation status (e.g., "completed", "in-progress", "blocked")'),
        codeChanges: z.array(z.string()).optional().describe('List of code changes or files modified'),
        filesCreated: z.array(z.string()).optional().describe('New files created or existing files modified'),
        tags: z.array(z.string()).optional().describe('Tags for categorization and filtering')
    },
    async ({ content, type, keyDecisions, status, codeChanges, filesCreated, tags }) => {
        try {
            const memoryId = await storeDevProgress(dbService, content, type as MemoryType, {
                key_decisions: keyDecisions,
                implementation_status: status,
                code_changes: codeChanges,
                files_created: filesCreated,
                date: new Date().toISOString()
            });

            if (tags) {
                await dbService.addMemoryTags(memoryId, tags);
            }

            return {
                content: [{
                    type: 'text',
                    text: `Successfully stored memory with ID: ${formatHashForDisplay(memoryId)}`
                }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Error storing memory: ${error}`
                }]
            };
        }
    }
);

// Add tool to list development memories
server.tool(
    'list-dev-memories',
    'List recent development memories with efficient pagination. Use limit parameter to control results.',
    {
        limit: z.number().optional().describe('Maximum number of memories to return (default: 10, helps with performance)'),
        tag: z.string().optional().describe('Filter by tag (TODO: not yet implemented)')
    },
    async ({ limit = 10, tag }) => {
        try {
            // Pass limit directly to database for efficient pagination
            const memories = await dbService.getDevMemories(limit);

            if (tag) {
                // TODO: Implement proper tag filtering using database queries
                console.error(`Note: Tag filtering for "${tag}" not yet implemented in list operation`);
                // For now, filter in memory but only on the already-limited results
                const filtered = memories.filter(memory => {
                    // This is a placeholder - proper implementation should use SQL filtering
                    return true; // TODO: implement tag filtering at DB level
                });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(filtered.map(memory => ({
                            ...memory,
                            memory_id: formatHashForDisplay(memory.memory_id)
                        })), null, 2)
                    }]
                };
            }
            
            // Format memories with hex IDs for display
            const displayMemories = memories.map(memory => ({
                ...memory,
                memory_id: formatHashForDisplay(memory.memory_id)
            }));
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(displayMemories, null, 2)
                }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Error listing memories: ${error}`
                }]
            };
        }
    }
);

// Add tool to get specific memory
server.tool(
    'get-dev-memory',
    'Retrieve a specific development memory by its hash ID. IDs are shown in hex format (e.g., a1b2c3d4e5f67890).',
    {
memoryId: z.string().describe('Hash ID of the memory to retrieve (hex format like a1b2c3d4e5f67890)')
    },
    async ({ memoryId }) => {
        try {
            // Convert hex format to hash ID for database lookup
            let hashId: string;
            try {
                hashId = parseHexToHash(memoryId);
                if (!isValidHashId(hashId)) {
                    throw new Error('Invalid hash format');
                }
            } catch {
                return {
                    isError: true,
                    content: [{
                        type: 'text',
                        text: `Invalid memory ID format: ${memoryId}. Expected hex format like a1b2c3d4e5f67890`
                    }]
                };
            }
            
            const memory = await dbService.getMemory(hashId);
            if (!memory) {
                return {
                    isError: true,
                    content: [{
                        type: 'text',
                        text: `Memory with ID ${memoryId} not found`
                    }]
                };
            }

            // Format memory with hex ID for display
            const displayMemory = {
                ...memory,
                memory_id: formatHashForDisplay(memory.memory_id)
            };

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(displayMemory, null, 2)
                }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Error retrieving memory: ${error}`
                }]
            };
        }
    }
);

// Add tool for semantic search
server.tool(
    'search',
    'Find similar memories using AI-powered semantic search (pgvector). Returns results ranked by similarity.',
    {
        searchTerm: z.string().describe('Text to search for - finds semantically similar memories using AI embeddings')
    },
    async ({ searchTerm }) => {
        try {
            console.error('Searching for:', searchTerm);
            const memories = await dbService.findSimilarMemories(searchTerm, 5);
            console.error('Found memories:', memories.length);
            
            if (!memories.length) {
                return {
                    content: [{
                        type: 'text',
                        text: 'No similar memories found.'
                    }]
                };
            }

            const formattedResults = memories.map(memory => {
                const metadata = typeof memory.metadata === 'string' 
                    ? JSON.parse(memory.metadata) 
                    : memory.metadata;
                return {
                    id: formatHashForDisplay(memory.memory_id),  // Display as hex
                    similarity: `${((memory.similarity || 0) * 100).toFixed(1)}%`,
                    content: memory.content,
                    type: memory.content_type,
                    status: metadata.implementation_status,
                    keyDecisions: metadata.key_decisions,
                    created: memory.created_at
                };
            });

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(formattedResults, null, 2)
                }]
            };
        } catch (error) {
            console.error('Search error:', error);
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Error searching memories: ${error}`
                }]
            };
        }
    }
);

// Initialize server transport
const transport = new StdioServerTransport();
server.connect(transport);

console.error('Memory MCP Server started'); 