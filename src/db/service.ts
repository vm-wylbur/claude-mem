// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/service-new.ts

import { z } from 'zod';
import { sha256Hex } from '../utils/hash.js';
import {
  DatabaseAdapter,
  DatabaseConnectionInfo,
  QueueFix,
  QueueFixConsumedOutcome,
  QueueFixFilter,
  QueueFixInput,
} from './adapters/base.js';

import { rerankConfigFromEnv, rerankByBge, type RerankConfig } from './rerank.js';

export type { QueueFix, QueueFixFilter, QueueFixInput, QueueFixConsumedOutcome } from './adapters/base.js';

// Re-export types from base for backwards compatibility
export const MemoryType = z.enum(['conversation', 'code', 'decision', 'reference']);
export type MemoryType = z.infer<typeof MemoryType>;

// Client-supplied write provenance (Phase-A centerpiece, neg-2baa74e7).
// Typed columns on memories, kept SEPARATE from the server-generated
// metadata jsonb. All fields optional: absence is the back-compat path.
// episode_id and valid_at/invalid_at are deliberately NOT here (derived
// substrate grouping / Phase-B greenfield, per the task-split spec).
export const MemoryProvenance = z.object({
    session_id: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    agent_id: z.string().min(1).optional()
});
export type MemoryProvenance = z.infer<typeof MemoryProvenance>;

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
 * - Consistent API for PostgreSQL backend
 * - Dependency inversion principle applied
 * 
 * @example
 * ```typescript
 * const adapter = new PostgresAdapter(config);
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
    // Kill-switch for the Phase 1 hybrid retrieval path. Off by default so
    // deploying the code changes nothing until MCPMEM_HYBRID_SEARCH is set.
    // Read once at construction: toggling requires a service restart (no
    // code redeploy), since the server builds one DatabaseService at startup.
    private readonly useHybridSearch: boolean;
    // bge rerank slot (Phase-A A6). Resolved once at construction; null = off
    // (flag unset, or set but no bearer -> degrade to hybrid). Only meaningful
    // when hybrid is on, since rerank reorders the hybrid pool.
    private readonly rerankConfig: RerankConfig | null;

    constructor(adapter: DatabaseAdapter) {
        this.adapter = adapter;
        this.useHybridSearch = /^(1|true|yes|on)$/i.test(process.env.MCPMEM_HYBRID_SEARCH ?? '');
        this.rerankConfig = this.useHybridSearch ? rerankConfigFromEnv() : null;
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
        metadata: MemoryMetadata,
        sourceKey?: string,
        sourceDocId?: string,
        provenance?: MemoryProvenance
    ): Promise<string> {
        if (!this.devProjectId) {
            throw new Error('DatabaseService not initialized. Call initialize() first.');
        }

        return this.adapter.storeMemory(content, type, metadata, this.devProjectId, sourceKey, sourceDocId, provenance);
    }

    /**
     * Store a memory in a specific project
     */
    async storeMemory(
        content: string,
        type: MemoryType,
        metadata: MemoryMetadata,
        projectId: string,
        sourceKey?: string,
        sourceDocId?: string,
        provenance?: MemoryProvenance
    ): Promise<string> {
        return this.adapter.storeMemory(content, type, metadata, projectId, sourceKey, sourceDocId, provenance);
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

        if (this.useHybridSearch) {
            if (this.rerankConfig) {
                // Rerank reorders a wider pool, then we slice top-k. The pool is
                // fetched WITH content (search_hybrid returns it) since bge scores
                // query-against-content.
                const poolSize = Math.max(this.rerankConfig.pool, limit);
                const pool = await this.adapter.findSimilarMemoriesHybrid(content, poolSize, this.devProjectId);
                try {
                    const reranked = await rerankByBge(content, pool, this.rerankConfig);
                    return reranked.slice(0, limit);
                } catch (err) {
                    // Degrade to hybrid: the pool is already in hybrid score order,
                    // so its top-`limit` is exactly the non-rerank hybrid result.
                    console.error('rerank failed; using hybrid order:', err instanceof Error ? err.message : err);
                    return pool.slice(0, limit);
                }
            }
            return this.adapter.findSimilarMemoriesHybrid(content, limit, this.devProjectId);
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

    //
    // Lessons-Learned Documentation Operations
    //

    /**
     * Get all lessons-learned documents from the database
     * Returns basic metadata for change detection (filepath, doc_hash)
     */
    async getLessonsLearnedDocs(): Promise<Array<{filepath: string; doc_hash: string; doc_id: string; file_mtime: string}>> {
        const adapter = this.adapter as any;
        if (!adapter.pool) {
            throw new Error('PostgreSQL adapter not connected');
        }

        const client = await adapter.pool.connect();
        try {
            const result = await client.query(
                'SELECT doc_id, filepath, doc_hash, file_mtime FROM lessons_learned_docs'
            );
            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Upsert (insert or update) a lessons-learned document.
     *
     * doc_hash is derived here from content (sha256), NOT taken from the caller
     * (issue #6 / neg-305c49e5). The service holds the content, so it is the
     * authoritative source of the hash — a stale/buggy client cannot write a
     * doc_hash that disagrees with sha256(content) and poison dedup lineage.
     */
    async upsertLessonsLearnedDoc(doc: {
        doc_id: string;
        filename: string;
        filepath: string;
        content: string;
        file_mtime: string;
        metadata: any;
    }): Promise<void> {
        const adapter = this.adapter as any;
        if (!adapter.pool) {
            throw new Error('PostgreSQL adapter not connected');
        }

        const doc_hash = sha256Hex(doc.content);

        const client = await adapter.pool.connect();
        try {
            await client.query(
                `INSERT INTO lessons_learned_docs (doc_id, filename, filepath, content, file_mtime, doc_hash, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT(filepath) DO UPDATE SET
                   content = EXCLUDED.content,
                   file_mtime = EXCLUDED.file_mtime,
                   doc_hash = EXCLUDED.doc_hash,
                   metadata = EXCLUDED.metadata`,
                [doc.doc_id, doc.filename, doc.filepath, doc.content, doc.file_mtime, doc_hash, JSON.stringify(doc.metadata)]
            );
        } finally {
            client.release();
        }
    }

    /**
     * Fetch one lessons-learned doc by its doc_id (PK), with full content.
     * Returns null if no such doc. Backs GET /docs/:doc_id, which eval.py uses
     * in place of the ssh-psql load_docs path (the manifest omits content).
     */
    async getDoc(doc_id: string): Promise<{
        doc_id: string; filename: string; filepath: string; content: string;
        file_mtime: string; doc_hash: string; metadata: any;
    } | null> {
        const adapter = this.adapter as any;
        if (!adapter.pool) {
            throw new Error('PostgreSQL adapter not connected');
        }
        const client = await adapter.pool.connect();
        try {
            const result = await client.query(
                `SELECT doc_id, filename, filepath, content, file_mtime, doc_hash, metadata
                 FROM lessons_learned_docs WHERE doc_id = $1`,
                [doc_id]
            );
            return result.rows[0] ?? null;
        } finally {
            client.release();
        }
    }

    /**
     * The distill backlog: raw docs not yet processed, DISTINCT by doc_hash
     * (distill once per distinct content), newest-representative per hash. A
     * doc_hash is excluded once ANY of its doc_ids has an extraction_decision
     * OR a source_doc_id-linked memory -- exclusion is by doc_hash, NOT by the
     * DISTINCT ON-picked doc_id. The same content can live at several filepaths
     * (several doc_ids); deciding/distilling one must retire all siblings. This
     * is the corrected, server-side form of distill.py's backlog query -- the
     * by-doc_id version let decided content resurface via its sibling paths
     * (the HIGH dedup bug). Backs GET /docs/backlog. total = distinct
     * non-excluded doc_hashes (for pagination); limit/offset page the reps.
     */
    async getBacklogDocs(limit: number, offset: number): Promise<{
        docs: Array<{ doc_id: string; doc_hash: string; filepath: string; content: string }>;
        total: number;
    }> {
        const adapter = this.adapter as any;
        if (!adapter.pool) {
            throw new Error('PostgreSQL adapter not connected');
        }
        // doc_hashes whose content is already decided or distilled (any sibling).
        // doc_hash is NOT NULL, so NOT IN is safe (no NULL-swallows-all hazard).
        const excludedHashes = `
            SELECT DISTINCT d.doc_hash
            FROM lessons_learned_docs d
            WHERE d.doc_id IN (SELECT doc_id FROM extraction_decisions WHERE doc_id IS NOT NULL)
               OR d.doc_id IN (SELECT source_doc_id FROM memories WHERE source_doc_id IS NOT NULL)
        `;
        const client = await adapter.pool.connect();
        try {
            const totalRes = await client.query(
                `SELECT count(*)::int AS total FROM (
                    SELECT DISTINCT doc_hash FROM lessons_learned_docs
                    WHERE doc_hash NOT IN (${excludedHashes})
                 ) t`
            );
            const docsRes = await client.query(
                `SELECT doc_id, doc_hash, filepath, content FROM (
                    SELECT DISTINCT ON (doc_hash)
                           doc_id, doc_hash, filepath, content, created_at
                    FROM lessons_learned_docs
                    WHERE doc_hash NOT IN (${excludedHashes})
                    ORDER BY doc_hash, created_at, doc_id
                 ) reps
                 ORDER BY doc_hash
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            );
            return { docs: docsRes.rows, total: totalRes.rows[0].total };
        } finally {
            client.release();
        }
    }

    /**
     * Record one extraction decision (approved / edited / skipped) into the
     * labeled set. doc_id links to lessons_learned_docs; stored_memory_id is
     * the memory created for approved/edited (null for skipped). Upserts on
     * (doc_id, insight_number); returns the decision_id (newly inserted, or
     * the existing row's id when a retry/re-decision updates in place).
     */
    async recordExtractionDecision(d: {
        doc_id?: string | null;
        doc_filename: string;
        insight_number: number;
        insight_title?: string | null;
        insight_content: string;
        insight_tags?: string[] | null;
        action: 'approved' | 'edited' | 'skipped';
        edited_content?: string | null;
        skip_reason?: string | null;
        stored_memory_id?: string | null;
    }): Promise<number> {
        const adapter = this.adapter as any;
        if (!adapter.pool) {
            throw new Error('PostgreSQL adapter not connected');
        }
        const client = await adapter.pool.connect();
        try {
            const res = await client.query(
                // ON CONFLICT (doc_id, insight_number): a retried POST /decision
                // (committed server-side, timed out client-side) upserts instead of
                // double-logging -- the labeled set is the product. A genuine
                // re-decision (skip->approve) also replaces, so this is current-state,
                // not an append log. NULLS DISTINCT (default) exempts doc-less rows;
                // the harvester always supplies doc_id, so it gets the dedup.
                `INSERT INTO extraction_decisions
                   (doc_id, doc_filename, insight_number, insight_title, insight_content,
                    insight_tags, action, edited_content, skip_reason, stored_memory_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (doc_id, insight_number) DO UPDATE SET
                   doc_filename     = EXCLUDED.doc_filename,
                   insight_title    = EXCLUDED.insight_title,
                   insight_content  = EXCLUDED.insight_content,
                   insight_tags     = EXCLUDED.insight_tags,
                   action           = EXCLUDED.action,
                   edited_content   = EXCLUDED.edited_content,
                   skip_reason      = EXCLUDED.skip_reason,
                   stored_memory_id = EXCLUDED.stored_memory_id,
                   "timestamp"      = CURRENT_TIMESTAMP
                 RETURNING decision_id`,
                [d.doc_id ?? null, d.doc_filename, d.insight_number, d.insight_title ?? null,
                 d.insight_content, d.insight_tags ?? null, d.action,
                 d.edited_content ?? null, d.skip_reason ?? null, d.stored_memory_id ?? null]
            );
            return res.rows[0].decision_id;
        } finally {
            client.release();
        }
    }

    //
    // IaC Drift Queue (queue_fixes)
    //

    /** Append a queue_fix entry. Returns numeric id. */
    async createQueueFix(input: QueueFixInput): Promise<number> {
        return this.adapter.createQueueFix(input);
    }

    /** List queue_fix entries by target_repo + status (FIFO order). */
    async listQueueFixes(filter: QueueFixFilter): Promise<QueueFix[]> {
        return this.adapter.listQueueFixes(filter);
    }

    /** Mark a queue_fix entry consumed (encoded into IaC). */
    async markQueueFixConsumed(id: number, outcome: QueueFixConsumedOutcome): Promise<void> {
        return this.adapter.markQueueFixConsumed(id, outcome);
    }

    /** Mark a queue_fix entry escalated (drainer can't auto-encode). */
    async markQueueFixEscalated(id: number, reason: string): Promise<void> {
        return this.adapter.markQueueFixEscalated(id, reason);
    }

    /** Mark a queue_fix entry superseded by a later entry. */
    async markQueueFixSuperseded(id: number, supersededBy: number): Promise<void> {
        return this.adapter.markQueueFixSuperseded(id, supersededBy);
    }
}