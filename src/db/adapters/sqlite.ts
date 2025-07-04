// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/adapters/sqlite.ts

import Database from 'better-sqlite3';
import { DatabaseAdapter, DatabaseConfig, DatabaseConnectionError, DatabaseConnectionInfo } from './base.js';
import { MemoryType, MemoryMetadata, Memory } from '../service.js';
import { generateEmbedding, storeEmbedding } from '../../embeddings.js';
import { generateMemoryHash, generateTagHash, initializeHasher } from '../../utils/hash.js';

/**
 * SQLite Database Adapter Implementation
 * 
 * Provides SQLite backend for the memory management system.
 * Uses better-sqlite3 for database operations and in-memory cosine similarity
 * for semantic search since SQLite doesn't have native vector operations.
 * 
 * @features
 * - BLOB storage for embeddings with in-memory similarity calculation
 * - JSON metadata storage with string serialization
 * - Synchronous operations (SQLite nature)
 * - File-based database with configurable path
 */
export class SqliteAdapter implements DatabaseAdapter {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;
  private isConnected = false;

  constructor(config: DatabaseConfig) {
    if (config.type !== 'sqlite' || !config.sqlite) {
      throw new DatabaseConnectionError('Invalid SQLite configuration', 'sqlite');
    }
    this.config = config;
  }

  //
  // Connection Lifecycle
  //

  async connect(): Promise<void> {
    try {
      // Initialize hash utility
      await initializeHasher();
      
      const dbPath = this.config.sqlite!.path;
      this.db = new Database(dbPath, { readonly: false });
      
      // Verify database has required tables
      const tables = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('projects', 'memories', 'embeddings', 'tags', 'memory_tags')
      `).all();
      
      if (tables.length < 5) {
        throw new DatabaseConnectionError(
          'Database missing required tables. Run database initialization first.', 
          'sqlite'
        );
      }
      
      this.isConnected = true;
    } catch (error) {
      throw new DatabaseConnectionError(
        `Failed to connect to SQLite: ${error}`,
        'sqlite'
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isConnected = false;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.db || !this.isConnected) return false;
    
    try {
      // Simple query to test connection
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  async getDatabaseInfo(): Promise<DatabaseConnectionInfo> {
    const sqliteConfig = this.config.sqlite!;
    
    // Basic connection info
    const info: DatabaseConnectionInfo = {
      type: 'sqlite',
      database: sqliteConfig.path,
      lastHealthCheck: new Date(),
      isConnected: this.isConnected
    };

    // Get detailed info if connected
    if (this.db && this.isConnected) {
      try {
        // SQLite doesn't have connection pools, but we can get basic stats
        const tableCountResult = this.db.prepare(`
          SELECT COUNT(*) as count FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).get() as { count: number };
        
        const memoryCountResult = this.db.prepare(`
          SELECT COUNT(*) as count FROM memories
        `).get() as { count: number };

        // SQLite version
        const versionResult = this.db.prepare('SELECT sqlite_version()').get() as { 'sqlite_version()': string };
        
        // Add SQLite-specific info (no connection pool for SQLite)
        info.connectionPool = {
          totalConnections: 1,
          activeConnections: this.isConnected ? 1 : 0,
          idleConnections: 0,
          waitingClients: 0
        };

        // Store additional SQLite info in unused postgres field for compatibility
        info.postgresVersion = `SQLite ${versionResult['sqlite_version()']}`;
        info.pgvectorVersion = `In-memory cosine similarity (${memoryCountResult.count} memories)`;

      } catch (error) {
        // If we can't get detailed info, mark as unhealthy
        info.isConnected = false;
      }
    }

    return info;
  }

  //
  // Core Memory Operations
  //

  async storeMemory(
    content: string,
    type: MemoryType,
    metadata: MemoryMetadata,
    projectId: string
  ): Promise<string> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    // Generate hash-based memory ID
    const memoryId = generateMemoryHash(content, type);

    // Generate embedding for content
    const vector = await generateEmbedding(content);
    const embeddingId = storeEmbedding(this.db, vector);

    // Store memory with hash ID and embedding reference
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (memory_id, project_id, content, content_type, metadata, embedding_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memoryId,
      projectId,
      content,
      type,
      JSON.stringify(metadata),
      embeddingId
    );

    return memoryId;
  }

  async getMemory(memoryId: string): Promise<Memory | null> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    const stmt = this.db.prepare('SELECT * FROM memories WHERE memory_id = ?');
    const result = stmt.get(memoryId) as any;
    
    return result || null;
  }

  async getProjectMemories(projectId: string, limit?: number): Promise<Memory[]> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    let query = `
      SELECT * FROM memories 
      WHERE project_id = ? 
      ORDER BY created_at DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const stmt = this.db.prepare(query);
    return stmt.all(projectId) as Memory[];
  }

  //
  // Search Operations
  //

  async findSimilarMemories(
    content: string,
    limit: number,
    projectId?: string
  ): Promise<Memory[]> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    // Generate embedding for search query
    const queryVector = await generateEmbedding(content);
    
    // Get all memories with embeddings
    let whereClause = '';
    let params: any[] = [];
    
    if (projectId) {
      whereClause = 'WHERE m.project_id = ?';
      params.push(projectId);
    }

    const stmt = this.db.prepare(`
      SELECT m.*, e.vector
      FROM memories m
      JOIN embeddings e ON m.embedding_id = e.embedding_id
      ${whereClause}
    `);

    const memories = stmt.all(...params);

    // Calculate similarities in memory (SQLite doesn't support vector operations)
    const results = memories.map((memory: any) => {
      // Convert BLOB to Float64Array
      const buffer = Buffer.from(memory.vector);
      const float64Array = new Float64Array(buffer.buffer, buffer.byteOffset, buffer.length / 8);
      
      // Calculate cosine similarity
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      
      for (let i = 0; i < queryVector.length; i++) {
        dotProduct += queryVector[i] * float64Array[i];
        normA += queryVector[i] * queryVector[i];
        normB += float64Array[i] * float64Array[i];
      }
      
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      
      // Remove vector from result and add similarity
      const { vector: _, ...memoryWithoutVector } = memory;
      return { ...memoryWithoutVector, similarity };
    });

    // Sort by similarity and return top results
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async searchByMetadata(
    query: Record<string, any>,
    projectId?: string
  ): Promise<Memory[]> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    // SQLite JSON support is limited, so we'll do basic string matching
    // This is a simplified implementation - PostgreSQL version will be more sophisticated
    let whereConditions = [];
    let params: any[] = [];

    // Add project filter if specified
    if (projectId) {
      whereConditions.push('project_id = ?');
      params.push(projectId);
    }

    // Add metadata search conditions
    for (const [key, value] of Object.entries(query)) {
      whereConditions.push(`metadata LIKE ?`);
      params.push(`%"${key}"%${value}%`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      ${whereClause}
      ORDER BY created_at DESC
    `);

    return stmt.all(...params) as Memory[];
  }

  //
  // Project Management
  //

  async createProject(name: string, description?: string): Promise<string> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    // Generate hash-based project ID
    const projectId = generateTagHash(name); // Use tag hash for projects
    
    const stmt = this.db.prepare(`
      INSERT INTO projects (project_id, name, description)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(projectId, name, description || null);
    return projectId;
  }

  async getProject(name: string): Promise<{project_id: string; name: string; description?: string} | null> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    const stmt = this.db.prepare('SELECT project_id, name, description FROM projects WHERE name = ?');
    const result = stmt.get(name) as any;
    
    return result || null;
  }

  //
  // Tag Management
  //

  async addMemoryTags(memoryId: string, tags: string[]): Promise<void> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

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

  async getMemoryTags(memoryId: string): Promise<string[]> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    const stmt = this.db.prepare(`
      SELECT t.name 
      FROM tags t
      JOIN memory_tags mt ON t.tag_id = mt.tag_id
      WHERE mt.memory_id = ?
    `);

    const results = stmt.all(memoryId) as any[];
    return results.map(row => row.name);
  }

  async getAllTags(projectId?: string): Promise<string[]> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    let query = 'SELECT DISTINCT t.name FROM tags t';
    let params: any[] = [];

    if (projectId) {
      query += `
        JOIN memory_tags mt ON t.tag_id = mt.tag_id
        JOIN memories m ON mt.memory_id = m.memory_id
        WHERE m.project_id = ?
      `;
      params.push(projectId);
    }
    
    query += ' ORDER BY t.name';
    
    const stmt = this.db.prepare(query);
    const results = stmt.all(...params) as any[];
    return results.map(row => row.name);
  }

  async getMemoriesByTag(tagName: string, projectId?: string, limit?: number): Promise<Memory[]> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    let query = `
      SELECT DISTINCT m.*
      FROM memories m
      JOIN memory_tags mt ON m.memory_id = mt.memory_id
      JOIN tags t ON mt.tag_id = t.tag_id
      WHERE t.name = ?
    `;
    let params: any[] = [tagName];

    if (projectId) {
      query += ' AND m.project_id = ?';
      params.push(projectId);
    }

    query += ' ORDER BY m.created_at DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Memory[];
  }

  //
  // Relationship Management
  //

  async createMemoryRelationship(
    sourceMemoryId: string,
    targetMemoryId: string,
    relationshipType: string
  ): Promise<void> {
    if (!this.db) throw new DatabaseConnectionError('Not connected', 'sqlite');

    const stmt = this.db.prepare(`
      INSERT INTO memory_relationships (source_memory_id, target_memory_id, relationship_type)
      VALUES (?, ?, ?)
    `);

    stmt.run(sourceMemoryId, targetMemoryId, relationshipType);
  }
}