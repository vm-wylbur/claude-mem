import Database from 'better-sqlite3';
import { z } from 'zod';
import { generateEmbedding, storeEmbedding } from '../embeddings.js';

// Schema definitions
export const MemoryType = z.enum(['conversation', 'code', 'decision', 'reference']);
export type MemoryType = z.infer<typeof MemoryType>;

export const MemoryMetadata = z.object({
    key_decisions: z.array(z.string()).optional(),
    implementation_status: z.string().optional(),
    code_changes: z.array(z.string()).optional(),
    dependencies_added: z.array(z.string()).optional(),
    files_created: z.array(z.string()).optional(),
    date: z.string(),
    related_memories: z.array(z.number()).optional()
});
export type MemoryMetadata = z.infer<typeof MemoryMetadata>;

interface ProjectRow {
    project_id: number;
    name: string;
    description: string | null;
    created_at: string;
    last_accessed: string;
}

export interface Memory {
    memory_id: number;
    content: string;
    content_type: string;
    metadata: string;
    similarity?: number;
    embedding_id?: number;
    project_id: number;
    created_at: string;
}

export class DatabaseService {
    private db: Database.Database;
    private devProjectId: number;

    constructor(db: Database.Database) {
        this.db = db;
        // Get development project ID
        const result = this.db.prepare('SELECT project_id FROM projects WHERE name = ?')
            .get('memory-mcp-development') as ProjectRow;
        if (!result) {
            throw new Error('Development project not found');
        }
        this.devProjectId = result.project_id;
    }

    /**
     * Store a development memory
     */
    async storeDevMemory(
        content: string,
        type: MemoryType,
        metadata: MemoryMetadata
    ): Promise<number> {
        // Generate embedding
        const vector = await generateEmbedding(content);
        const embeddingId = storeEmbedding(this.db, vector);

        const stmt = this.db.prepare(`
            INSERT INTO memories (project_id, content, content_type, metadata, embedding_id)
            VALUES (?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            this.devProjectId,
            content,
            type,
            JSON.stringify(metadata),
            embeddingId
        );

        return result.lastInsertRowid as number;
    }

    /**
     * Create a relationship between memories
     */
    createMemoryRelationship(
        sourceMemoryId: number,
        targetMemoryId: number,
        relationshipType: string
    ): void {
        const stmt = this.db.prepare(`
            INSERT INTO memory_relationships (source_memory_id, target_memory_id, relationship_type)
            VALUES (?, ?, ?)
        `);

        stmt.run(sourceMemoryId, targetMemoryId, relationshipType);
    }

    /**
     * Get all memories for the development project
     */
    getDevMemories(): any[] {
        return this.db.prepare(`
            SELECT * FROM memories
            WHERE project_id = ?
            ORDER BY created_at DESC
        `).all(this.devProjectId);
    }

    /**
     * Get a specific memory by ID
     */
    getMemory(memoryId: number): any {
        return this.db.prepare('SELECT * FROM memories WHERE memory_id = ?')
            .get(memoryId);
    }

    /**
     * Add tags to a memory
     */
    addMemoryTags(memoryId: number, tags: string[]): void {
        const insertTag = this.db.prepare(`
            INSERT OR IGNORE INTO tags (name) VALUES (?)
        `);
        
        const linkTag = this.db.prepare(`
            INSERT OR IGNORE INTO memory_tags (memory_id, tag_id)
            SELECT ?, tag_id FROM tags WHERE name = ?
        `);

        for (const tag of tags) {
            insertTag.run(tag);
            linkTag.run(memoryId, tag);
        }
    }

    /**
     * Find similar memories using semantic search
     */
    async findSimilarMemories(content: string, limit: number = 5): Promise<Memory[]> {
        const vector = await generateEmbedding(content);
        const stmt = this.db.prepare(`
            SELECT 
                m.*,
                e.vector
            FROM memories m
            JOIN embeddings e ON m.embedding_id = e.embedding_id
            WHERE m.project_id = ?
        `);

        const memories = stmt.all(this.devProjectId);
        
        // Calculate similarities in memory (SQLite doesn't support vector operations)
        const results = memories.map((memory: any) => {
            // Convert BLOB to Float64Array
            const buffer = Buffer.from(memory.vector);
            const float64Array = new Float64Array(buffer.buffer, buffer.byteOffset, buffer.length / 8);
            
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            
            for (let i = 0; i < vector.length; i++) {
                dotProduct += vector[i] * float64Array[i];
                normA += vector[i] * vector[i];
                normB += float64Array[i] * float64Array[i];
            }
            
            const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
            
            // Remove the vector from the result to avoid serialization issues
            const { vector: _, ...memoryWithoutVector } = memory;
            return { ...memoryWithoutVector, similarity };
        });
        
        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }
} 