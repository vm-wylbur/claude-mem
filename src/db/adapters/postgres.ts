// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/adapters/postgres.ts

import pg from 'pg';
import fs from 'fs';
// Removed: SSH tunnel imports no longer needed
import { DatabaseAdapter, DatabaseConfig, DatabaseConnectionError, DatabaseConnectionInfo } from './base.js';
import { MemoryType, MemoryMetadata, Memory } from '../service.js';
import { generateEmbedding } from '../../embeddings.js';
import { generateMemoryHash, generateTagHash, initializeHasher } from '../../utils/hash.js';

const { Pool } = pg;

/**
 * PostgreSQL Database Adapter Implementation with pgvector support
 * 
 * Provides PostgreSQL backend for the memory management system with native vector
 * similarity search using pgvector extension. Connects directly to managed PostgreSQL.
 * 
 * @features
 * - Native pgvector similarity search (cosine distance)
 * - Direct connection to managed PostgreSQL (Aiven)
 * - JSONB metadata storage with rich query capabilities
 * - Connection pooling for performance
 * - Transactional operations for data consistency
 * 
 * @references
 * - pgvector: https://github.com/pgvector/pgvector
 * - PostgreSQL JSONB: https://www.postgresql.org/docs/current/datatype-json.html
 */
export class PostgresAdapter implements DatabaseAdapter {
  private pool: pg.Pool | null = null;
  private config: DatabaseConfig;
  // Removed: SSH tunnel properties no longer needed
  private isConnected = false;

  constructor(config: DatabaseConfig) {
    if (config.type !== 'postgresql' || !config.postgresql) {
      throw new DatabaseConnectionError('Invalid PostgreSQL configuration', 'postgresql');
    }
    this.config = config;
  }

  //
  // Connection Lifecycle - Direct PostgreSQL Connection
  //

  async connect(): Promise<void> {
    const pgConfig = this.config.postgresql!;
    
    // Initialize hash utility
    await initializeHasher();
    
    // Removed: SSH tunnel logic - connecting directly to managed PostgreSQL

    try {
      // Create connection pool - direct connection to managed PostgreSQL
      this.pool = new Pool({
        host: pgConfig.hosts[0],
        port: pgConfig.port || 5432,
        database: pgConfig.database,
        user: pgConfig.user,
        password: pgConfig.password,
        ssl: pgConfig.sslmode ? { rejectUnauthorized: false } : false,
        max: pgConfig.max_connections || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: pgConfig.connection_timeout_ms || 5000,
      });

      // Add error handler to prevent server crashes on connection drops
      this.pool.on('error', (err) => {
        console.error('📊 Database pool error (connection drop):', err.message);
        // Don't crash the server - just log the error and continue
      });

      // Test connection and verify pgvector extension
      const client = await this.pool.connect();
      try {
        // Check for pgvector extension
        const extensionCheck = await client.query(`
          SELECT * FROM pg_extension WHERE extname = 'vector'
        `);
        
        if (extensionCheck.rows.length === 0) {
          throw new DatabaseConnectionError(
            'pgvector extension not installed. Run: CREATE EXTENSION vector;',
            'postgresql'
          );
        }

        // Verify required tables exist
        const tableCheck = await client.query(`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('projects', 'memories', 'tags', 'memory_tags', 'memory_relationships')
        `);
        
        if (tableCheck.rows.length < 5) {
          throw new DatabaseConnectionError(
            'Database missing required tables. Run database initialization first.',
            'postgresql'
          );
        }

        this.isConnected = true;
        console.error('✅ PostgreSQL connection established with pgvector support');
      } finally {
        client.release();
      }
    } catch (error) {
      await this.cleanup();
      throw new DatabaseConnectionError(
        `Failed to connect to PostgreSQL: ${error}`,
        'postgresql'
      );
    }
  }

  // Removed: establishSshTunnel() method - no longer needed for direct Aiven connection

  async disconnect(): Promise<void> {
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    // Removed: SSH cleanup no longer needed
    this.isConnected = false;
  }

  // Removed: cleanupSsh() method - no longer needed for direct Aiven connection

  async healthCheck(): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;
    
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        return true;
      } finally {
        client.release();
      }
    } catch {
      return false;
    }
  }

  async getDatabaseInfo(): Promise<DatabaseConnectionInfo> {
    const pgConfig = this.config.postgresql!;
    
    // Basic connection info
    const info: DatabaseConnectionInfo = {
      type: 'postgresql',
      host: pgConfig.hosts[0],
      port: pgConfig.port || 5432,
      database: pgConfig.database,
      lastHealthCheck: new Date(),
      isConnected: this.isConnected
    };

    // Get detailed info if connected
    if (this.pool && this.isConnected) {
      try {
        const client = await this.pool.connect();
        try {
          // Get connection pool stats
          info.connectionPool = {
            totalConnections: this.pool.totalCount,
            activeConnections: this.pool.totalCount - this.pool.idleCount,
            idleConnections: this.pool.idleCount,
            waitingClients: this.pool.waitingCount
          };

          // Get PostgreSQL version
          const versionResult = await client.query('SELECT version()');
          const versionString = versionResult.rows[0]?.version || '';
          const versionMatch = versionString.match(/PostgreSQL (\d+\.\d+)/);
          info.postgresVersion = versionMatch ? versionMatch[1] : 'unknown';

          // Get pgvector version
          const pgvectorResult = await client.query(`
            SELECT extversion FROM pg_extension WHERE extname = 'vector'
          `);
          info.pgvectorVersion = pgvectorResult.rows[0]?.extversion || 'not installed';

        } finally {
          client.release();
        }
      } catch (error) {
        // If we can't get detailed info, mark as unhealthy
        info.isConnected = false;
      }
    }

    return info;
  }

  //
  // Core Memory Operations with pgvector
  //

  async storeMemory(
    content: string,
    type: MemoryType,
    metadata: MemoryMetadata,
    projectId: string
  ): Promise<string> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Generate hash-based memory ID
      const memoryId = generateMemoryHash(content, type);

      // Generate embedding for content
      const vector = await generateEmbedding(content);
      
      // Store memory with hash ID and vector embedding
      const result = await client.query(`
        INSERT INTO memories (memory_id, project_id, content, content_type, metadata, embedding)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (memory_id) DO UPDATE SET
          updated_at = CURRENT_TIMESTAMP
        RETURNING memory_id
      `, [
        memoryId,
        projectId,
        content,
        type,
        JSON.stringify(metadata),
        JSON.stringify(vector) // Store as JSONB array for pgvector
      ]);

      await client.query('COMMIT');
      return result.rows[0].memory_id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMemory(memoryId: string): Promise<Memory | null> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM memories WHERE memory_id = $1',
        [memoryId]
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getProjectMemories(projectId: string, limit?: number): Promise<Memory[]> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      let query = `
        SELECT * FROM memories 
        WHERE project_id = $1 
        ORDER BY created_at DESC
      `;
      
      const params = [projectId];
      if (limit) {
        query += ` LIMIT $2`;
        params.push(limit.toString());
      }

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  //
  // pgvector Similarity Search
  //

  async findSimilarMemories(
    content: string,
    limit: number,
    projectId?: string
  ): Promise<Memory[]> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      // Generate embedding for search query
      const queryVector = await generateEmbedding(content);
      
      // Use pgvector cosine distance for similarity search
      let whereClause = '';
      let params: any[] = [JSON.stringify(queryVector), limit];
      
      if (projectId) {
        whereClause = 'WHERE project_id = $3';
        params.push(projectId);
      }

      const result = await client.query(`
        SELECT *, 
               1 - (embedding::vector <=> $1::vector) AS similarity
        FROM memories 
        ${whereClause}
        ORDER BY embedding::vector <=> $1::vector
        LIMIT $2
      `, params);

      return result.rows;
    } finally {
      client.release();
    }
  }

  async searchByMetadata(
    query: Record<string, any>,
    projectId?: string
  ): Promise<Memory[]> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      // Use PostgreSQL JSONB operators for rich metadata queries
      const conditions = [];
      const params = [];
      let paramIndex = 1;

      // Add project filter if specified
      if (projectId) {
        conditions.push(`project_id = $${paramIndex}`);
        params.push(projectId);
        paramIndex++;
      }

      // Add metadata search conditions using JSONB operators
      for (const [key, value] of Object.entries(query)) {
        if (typeof value === 'string') {
          // Text search in JSONB
          conditions.push(`metadata->>'${key}' ILIKE $${paramIndex}`);
          params.push(`%${value}%`);
        } else if (Array.isArray(value)) {
          // Array contains search
          conditions.push(`metadata->'${key}' @> $${paramIndex}::jsonb`);
          params.push(JSON.stringify(value));
        } else {
          // Exact match
          conditions.push(`metadata->>'${key}' = $${paramIndex}`);
          params.push(String(value));
        }
        paramIndex++;
      }

      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const result = await client.query(`
        SELECT * FROM memories 
        ${whereClause}
        ORDER BY created_at DESC
      `, params);

      return result.rows;
    } finally {
      client.release();
    }
  }

  //
  // Project Management
  //

  async createProject(name: string, description?: string): Promise<string> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      // Generate sequential hex ID (find next available)
      const maxResult = await client.query(`
        SELECT project_id FROM projects 
        ORDER BY LENGTH(project_id) DESC, project_id DESC 
        LIMIT 1
      `);
      
      let nextId = 1;
      if (maxResult.rows.length > 0) {
        const lastHexId = maxResult.rows[0].project_id;
        const lastDecimal = parseInt(lastHexId, 16);
        nextId = lastDecimal + 1;
      }
      
      const hexProjectId = nextId.toString(16).padStart(16, '0');
      
      const result = await client.query(`
        INSERT INTO projects (project_id, name, description)
        VALUES ($1, $2, $3)
        RETURNING project_id
      `, [hexProjectId, name, description || null]);

      return result.rows[0].project_id;
    } finally {
      client.release();
    }
  }

  async getProject(name: string): Promise<{project_id: string; name: string; description?: string} | null> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT project_id, name, description FROM projects WHERE name = $1',
        [name]
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  //
  // Tag Management
  //

  async addMemoryTags(memoryId: string, tags: string[]): Promise<void> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const tagName of tags) {
        // First check if tag already exists
        const existingTag = await client.query(`
          SELECT tag_id FROM tags WHERE name = $1
        `, [tagName]);
        
        let tagId: string;
        
        if (existingTag.rows.length > 0) {
          // Use existing tag ID
          tagId = existingTag.rows[0].tag_id;
        } else {
          // Generate new hex-based tag ID and create tag
          tagId = generateTagHash(tagName);
          await client.query(`
            INSERT INTO tags (tag_id, name) VALUES ($1, $2)
          `, [tagId, tagName]);
        }
        
        // Link tag to memory using the correct tag ID
        await client.query(`
          INSERT INTO memory_tags (memory_id, tag_id)
          VALUES ($1, $2)
          ON CONFLICT (memory_id, tag_id) DO NOTHING
        `, [memoryId, tagId]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMemoryTags(memoryId: string): Promise<string[]> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT t.name 
        FROM tags t
        JOIN memory_tags mt ON t.tag_id = mt.tag_id
        WHERE mt.memory_id = $1
      `, [memoryId]);

      return result.rows.map(row => row.name);
    } finally {
      client.release();
    }
  }

  async getAllTags(projectId?: string): Promise<string[]> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      let query = 'SELECT DISTINCT t.name FROM tags t';
      let params: any[] = [];

      if (projectId) {
        query += `
          JOIN memory_tags mt ON t.tag_id = mt.tag_id
          JOIN memories m ON mt.memory_id = m.memory_id
          WHERE m.project_id = $1
        `;
        params.push(projectId);
      }
      
      query += ' ORDER BY t.name';
      
      const result = await client.query(query, params);
      return result.rows.map(row => row.name);
    } finally {
      client.release();
    }
  }

  async getMemoriesByTag(tagName: string, projectId?: string, limit?: number): Promise<Memory[]> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      let query = `
        SELECT DISTINCT m.*, 1 - (m.embedding::vector <=> m.embedding::vector) AS similarity
        FROM memories m
        JOIN memory_tags mt ON m.memory_id = mt.memory_id
        JOIN tags t ON mt.tag_id = t.tag_id
        WHERE t.name = $1
      `;
      let params: any[] = [tagName];

      if (projectId) {
        query += ' AND m.project_id = $2';
        params.push(projectId);
      }

      query += ' ORDER BY m.created_at DESC';

      if (limit) {
        const limitParam = projectId ? '$3' : '$2';
        query += ` LIMIT ${limitParam}`;
        params.push(limit);
      }

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  //
  // Relationship Management
  //

  async createMemoryRelationship(
    sourceMemoryId: string,
    targetMemoryId: string,
    relationshipType: string
  ): Promise<void> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO memory_relationships (source_memory_id, target_memory_id, relationship_type)
        VALUES ($1, $2, $3)
      `, [sourceMemoryId, targetMemoryId, relationshipType]);
    } finally {
      client.release();
    }
  }
}