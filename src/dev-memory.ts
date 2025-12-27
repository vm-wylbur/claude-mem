import { DatabaseService, MemoryType, MemoryMetadata } from './db/service.js';

export async function storeDevProgress(
    db: DatabaseService,
    content: string,
    type: MemoryType = 'decision',
    metadata: Partial<MemoryMetadata> = {}
): Promise<string> {
    const fullMetadata: MemoryMetadata = {
        date: new Date().toISOString(),
        ...metadata
    };

    return db.storeDevMemory(content, type, fullMetadata);
}

// Store our initial development progress
export async function storeInitialProgress(db: DatabaseService): Promise<void> {
    const memoryId = await storeDevProgress(
        db,
        'Initial project setup completed with core infrastructure components',
        'decision',
        {
            key_decisions: [
                'Created project structure with TypeScript and ES modules',
                'Set up PostgreSQL database with pgvector for projects, memories, embeddings, and relationships',
                'Chose Ollama with nomic-embed-text for embeddings (768 dimensions)',
                'Implemented development memory tracking system',
                'Created DatabaseService class for database operations'
            ],
            implementation_status: 'setup',
            files_created: [
                'src/db/service.ts - Database service layer',
                'src/db/adapters/postgres.ts - PostgreSQL adapter',
                'src/dev-memory.ts - Development memory helpers',
                'schema-postgresql.sql - Database schema',
                'package.json, tsconfig.json - Project configuration'
            ],
            dependencies_added: [
                '@modelcontextprotocol/sdk@^1.7.0',
                'pg@^8.11.3',
                'node-fetch@^3.3.2',
                'zod@^3.22.4'
            ]
        }
    );

    // Add relevant tags
    db.addMemoryTags(memoryId, [
        'setup',
        'infrastructure',
        'database',
        'typescript',
        'ollama'
    ]);

    // Store memory about MCP tools implementation
    const toolsMemoryId = await storeDevProgress(
        db,
        'Implemented MCP tools for development memory interaction',
        'code',
        {
            key_decisions: [
                'Created three main MCP tools for memory interaction',
                'Switched from @ollama/vectors to direct Ollama API calls',
                'Added proper error handling in MCP tools'
            ],
            implementation_status: 'in_progress',
            code_changes: [
                'Added store-dev-memory tool for creating new memories',
                'Added list-dev-memories tool with tag filtering',
                'Added get-dev-memory tool for retrieving specific memories',
                'Updated package.json to use node-fetch instead of @ollama/vectors'
            ],
            files_created: [
                'Updated src/index.ts with MCP tools implementation'
            ]
        }
    );

    // Add tags for the tools memory
    db.addMemoryTags(toolsMemoryId, [
        'mcp',
        'tools',
        'implementation',
        'api'
    ]);

    // Create relationship between memories
    db.createMemoryRelationship(toolsMemoryId, memoryId, 'builds_on');
} 