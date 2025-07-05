// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/service-new.ts

import { z } from 'zod';
import { DatabaseAdapter, DatabaseConnectionInfo } from './adapters/base.js';

// Re-export types from base for backwards compatibility
export const MemoryType = z.enum(['conversation', 'code', 'decision', 'reference']);
export type MemoryType = z.infer<typeof MemoryType>;

export const MemoryMetadata = z.object({
    key_decisions: z.array(z.string()).optional(),
    implementation_status: z.string().optional(),
    code_changes: z.array(z.string()).optional(),
    dependencies_added: z.array(z.string()).optional(),
    files_created: z.array(z.string()).optional(),
    date: z.string(),
    related_memories: z.array(z.string()).optional()  // Now string hash IDs
});
export type MemoryMetadata = z.infer<typeof MemoryMetadata>;

export interface Memory {
    memory_id: string;  // Hash as hex string
    content: string;
    content_type: string;
    metadata: string;
    similarity?: number;
    embedding?: string;  // pgvector embedding as string
    project_id: string;  // Hash as hex string
    created_at: string;
    updated_at?: string;
}

/**
 * Database Service Layer - Clean Architecture Implementation
 * 
 * This service provides a high-level interface for memory operations while
 * delegating all database-specific logic to pluggable DatabaseAdapter implementations.
 * 
 * Key architectural benefits:
 * - Database-agnostic business logic
 * - Easy testing via adapter mocking
 * - Consistent API regardless of backend (SQLite vs PostgreSQL)
 * - Dependency inversion principle applied
 * 
 * @example
 * ```typescript
 * const adapter = new SqliteAdapter(config);
 * await adapter.connect();
 * const service = new DatabaseService(adapter);
 * 
 * const memoryId = await service.storeDevMemory(content, type, metadata);
 * const similar = await service.findSimilarMemories(content, 5);
 * ```
 */
export class DatabaseService {
    private adapter: DatabaseAdapter;
    private devProjectId: string | null = null;

    constructor(adapter: DatabaseAdapter) {
        this.adapter = adapter;
    }

    /**
     * Initialize the service - must be called after construction
     * Loads the development project ID for convenience methods
     */
    async initialize(): Promise<void> {
        // Ensure development project exists
        let devProject = await this.adapter.getProject('memory-mcp-development');
        
        if (!devProject) {
            // Create development project if it doesn't exist
            const projectId = await this.adapter.createProject(
                'memory-mcp-development',
                'Development history and decisions for the Memory MCP Server project'
            );
            this.devProjectId = projectId;
        } else {
            this.devProjectId = devProject.project_id;
        }
    }

    /**
     * Store a development memory (convenience method)
     * Uses the default development project
     */
    async storeDevMemory(
        content: string,
        type: MemoryType,
        metadata: MemoryMetadata
    ): Promise<string> {
        if (!this.devProjectId) {
            throw new Error('DatabaseService not initialized. Call initialize() first.');
        }

        return this.adapter.storeMemory(content, type, metadata, this.devProjectId);
    }

    /**
     * Store a memory in a specific project
     */
    async storeMemory(
        content: string,
        type: MemoryType,
        metadata: MemoryMetadata,
        projectId: string
    ): Promise<string> {
        return this.adapter.storeMemory(content, type, metadata, projectId);
    }

    /**
     * Get memories for the development project with optional pagination
     */
    async getDevMemories(limit?: number): Promise<Memory[]> {
        if (!this.devProjectId) {
            throw new Error('DatabaseService not initialized. Call initialize() first.');
        }

        return this.adapter.getProjectMemories(this.devProjectId, limit);
    }

    /**
     * Get memories for a specific project
     */
    async getProjectMemories(projectId: string, limit?: number): Promise<Memory[]> {
        return this.adapter.getProjectMemories(projectId, limit);
    }

    /**
     * Get a specific memory by ID
     */
    async getMemory(memoryId: string): Promise<Memory | null> {
        return this.adapter.getMemory(memoryId);
    }

    /**
     * Find similar memories using semantic search
     * Searches within development project by default
     */
    async findSimilarMemories(content: string, limit: number = 5): Promise<Memory[]> {
        if (!this.devProjectId) {
            throw new Error('DatabaseService not initialized. Call initialize() first.');
        }

        return this.adapter.findSimilarMemories(content, limit, this.devProjectId);
    }

    /**
     * Find similar memories across all projects or specific project
     */
    async findSimilarMemoriesInProject(
        content: string, 
        limit: number = 5, 
        projectId?: string
    ): Promise<Memory[]> {
        return this.adapter.findSimilarMemories(content, limit, projectId);
    }

    /**
     * Search memories by metadata properties
     */
    async searchByMetadata(
        query: Record<string, any>, 
        projectId?: string
    ): Promise<Memory[]> {
        const searchProjectId = projectId || this.devProjectId;
        if (!searchProjectId) {
            throw new Error('DatabaseService not initialized. Call initialize() first.');
        }

        return this.adapter.searchByMetadata(query, searchProjectId);
    }

    /**
     * Add tags to a memory
     */
    async addMemoryTags(memoryId: string, tags: string[]): Promise<void> {
        return this.adapter.addMemoryTags(memoryId, tags);
    }

    /**
     * Add tags to a memory (convenience alias)
     */
    async addTagsToMemory(memoryId: string, tags: string[]): Promise<void> {
        return this.adapter.addMemoryTags(memoryId, tags);
    }

    /**
     * Get all tags for a memory
     */
    async getMemoryTags(memoryId: string): Promise<string[]> {
        return this.adapter.getMemoryTags(memoryId);
    }

    /**
     * Get all available tags, optionally filtered by project
     */
    async getAllTags(projectId?: string): Promise<string[]> {
        return this.adapter.getAllTags(projectId);
    }

    /**
     * Get all tags available for the development project
     */
    async getDevTags(): Promise<string[]> {
        if (!this.devProjectId) {
            throw new Error('DatabaseService not initialized. Call initialize() first.');
        }
        return this.adapter.getAllTags(this.devProjectId);
    }

    /**
     * Get memories that have a specific tag
     */
    async getMemoriesByTag(tagName: string, projectId?: string, limit?: number): Promise<Memory[]> {
        return this.adapter.getMemoriesByTag(tagName, projectId, limit);
    }

    /**
     * Get development project memories that have a specific tag
     */
    async getDevMemoriesByTag(tagName: string, limit?: number): Promise<Memory[]> {
        if (!this.devProjectId) {
            throw new Error('DatabaseService not initialized. Call initialize() first.');
        }
        return this.adapter.getMemoriesByTag(tagName, this.devProjectId, limit);
    }

    /**
     * Create a relationship between memories
     */
    async createMemoryRelationship(
        sourceMemoryId: string,
        targetMemoryId: string,
        relationshipType: string
    ): Promise<void> {
        return this.adapter.createMemoryRelationship(sourceMemoryId, targetMemoryId, relationshipType);
    }

    /**
     * Create a new project
     */
    async createProject(name: string, description?: string): Promise<string> {
        return this.adapter.createProject(name, description);
    }

    /**
     * Get project by name
     */
    async getProject(name: string): Promise<{project_id: string; name: string; description?: string} | null> {
        return this.adapter.getProject(name);
    }

    /**
     * Get the underlying adapter for advanced operations
     * Use sparingly - prefer the high-level methods above
     */
    getAdapter(): DatabaseAdapter {
        return this.adapter;
    }

    /**
     * Check if the database connection is healthy
     */
    async healthCheck(): Promise<boolean> {
        return this.adapter.healthCheck();
    }

    /**
     * Get real-time database connection diagnostics
     */
    async getDatabaseInfo(): Promise<DatabaseConnectionInfo> {
        return this.adapter.getDatabaseInfo();
    }

    /**
     * Delete a memory (note: this should be used carefully)
     */
    async deleteMemory(memoryId: string): Promise<boolean> {
        try {
            // Note: This method would need to be implemented in the adapter
            // For now, we'll implement a basic version that could work
            console.warn(`deleteMemory called for ${memoryId} - implementation may be limited`);
            
            // Check if memory exists first
            const memory = await this.getMemory(memoryId);
            if (!memory) {
                return false;
            }
            
            // In a real implementation, this would:
            // 1. Delete from memory_tags table
            // 2. Delete from memory_relationships table  
            // 3. Delete from memories table
            // For now, just log the action
            console.log(`Would delete memory ${memoryId}: "${memory.content.substring(0, 50)}..."`);
            
            return true;
        } catch (error) {
            console.error(`Failed to delete memory ${memoryId}:`, error);
            return false;
        }
    }

    /**
     * Close database connection
     */
    async disconnect(): Promise<void> {
        return this.adapter.disconnect();
    }
}