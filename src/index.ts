import { config } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DatabaseService, MemoryType } from './db/service.js';
import { createDatabaseAdapter, getConfigSummary } from './config.js';
import { storeDevProgress, storeInitialProgress } from './dev-memory.js';

// Load environment variables
config();

// Initialize database adapter based on configuration
console.error(`🚀 Starting Memory MCP Server`);
console.error(`📊 Database: ${getConfigSummary()}`);

const adapter = await createDatabaseAdapter();
const dbService = new DatabaseService(adapter);
await dbService.initialize();

// Store initial development progress
await storeInitialProgress(dbService);

// Create MCP Server with proper initialization
const server = new McpServer({
    name: 'agent-memory',
    version: '1.0.0',
    capabilities: {
        tools: {
            'store-dev-memory': true,
            'list-dev-memories': true,
            'get-dev-memory': true,
            'search': true
        }
    }
});

// Add tool to store development progress
server.tool(
    'store-dev-memory',
    'Store a new development memory',
    {
        content: z.string().describe('The content of the memory'),
        type: z.enum(['conversation', 'code', 'decision', 'reference']).describe('Type of memory'),
        keyDecisions: z.array(z.string()).optional().describe('Key decisions made'),
        status: z.string().optional().describe('Implementation status'),
        codeChanges: z.array(z.string()).optional().describe('Code changes made'),
        filesCreated: z.array(z.string()).optional().describe('Files created or modified'),
        tags: z.array(z.string()).optional().describe('Tags to associate with the memory')
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
                    text: `Successfully stored memory with ID: ${memoryId}`
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
    'List all development memories',
    {
        limit: z.number().optional().describe('Maximum number of memories to return'),
        tag: z.string().optional().describe('Filter by tag')
    },
    async ({ limit = 10, tag }) => {
        try {
            const memories = await dbService.getDevMemories();
            let filtered = memories;

            if (tag) {
                // TODO: Implement proper tag filtering using database queries
                console.error(`Note: Tag filtering for "${tag}" not yet implemented in list operation`);
            }

            const limited = filtered.slice(0, limit);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(limited, null, 2)
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
    'Get a specific development memory by ID',
    {
        memoryId: z.number().describe('ID of the memory to retrieve')
    },
    async ({ memoryId }) => {
        try {
            const memory = await dbService.getMemory(memoryId);
            if (!memory) {
                return {
                    isError: true,
                    content: [{
                        type: 'text',
                        text: `Memory with ID ${memoryId} not found`
                    }]
                };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(memory, null, 2)
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
    'Search for similar memories using semantic search',
    {
        searchTerm: z.string().describe('Text to search for')
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
                const metadata = JSON.parse(memory.metadata);
                return {
                    id: memory.memory_id,
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