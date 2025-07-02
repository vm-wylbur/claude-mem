// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/adapters/postgres.ts

import pg from 'pg';
import fs from 'fs';
import { Client } from 'ssh2';
import { DatabaseAdapter, DatabaseConfig, DatabaseConnectionError } from './base.js';
import { MemoryType, MemoryMetadata, Memory } from '../service.js';
import { generateEmbedding } from '../../embeddings.js';

const { Pool } = pg;

/**
 * PostgreSQL Database Adapter Implementation with pgvector support
 * 
 * Provides PostgreSQL backend for the memory management system with native vector
 * similarity search using pgvector extension. Supports SSH tunnel connections
 * with snowl/snowball fallback strategy.
 * 
 * @features
 * - Native pgvector similarity search (cosine distance)
 * - SSH tunnel support with automatic failover
 * - JSONB metadata storage with rich query capabilities
 * - Connection pooling for performance
 * - Transactional operations for data consistency
 * 
 * @references
 * - pgvector: https://github.com/pgvector/pgvector
 * - PostgreSQL JSONB: https://www.postgresql.org/docs/current/datatype-json.html
 * - SSH Tunneling: https://github.com/mscdex/ssh2
 */
export class PostgresAdapter implements DatabaseAdapter {
  private pool: pg.Pool | null = null;
  private config: DatabaseConfig;
  private sshClient: Client | null = null;
  private localPort: number | null = null;
  private isConnected = false;

  constructor(config: DatabaseConfig) {
    if (config.type !== 'postgresql' || !config.postgresql) {
      throw new DatabaseConnectionError('Invalid PostgreSQL configuration', 'postgresql');
    }
    this.config = config;
  }

  //
  // Connection Lifecycle with SSH Tunnel Support
  //

  async connect(): Promise<void> {
    const pgConfig = this.config.postgresql!;
    
    if (pgConfig.tunnel) {
      await this.establishSshTunnel();
    }

    try {
      // Create connection pool
      this.pool = new Pool({
        host: pgConfig.tunnel ? 'localhost' : pgConfig.hosts[0],
        port: pgConfig.tunnel ? this.localPort! : 5432,
        database: pgConfig.database,
        user: pgConfig.user,
        max: 10, // Max connections in pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
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

  private async establishSshTunnel(): Promise<void> {
    const pgConfig = this.config.postgresql!;
    const tunnelPort = pgConfig.tunnelPort || 5433;
    
    // Try hosts in order (snowl first, then snowball)
    for (const host of pgConfig.hosts) {
      try {
        console.error(`🚇 Attempting SSH tunnel to ${host}...`);
        
        this.sshClient = new Client();
        this.localPort = tunnelPort;
        
        await new Promise<void>((resolve, reject) => {
          this.sshClient!.on('ready', () => {
            // Forward local port to remote PostgreSQL
            this.sshClient!.forwardOut(
              '127.0.0.1', 0, // Local binding
              '127.0.0.1', 5432, // Remote PostgreSQL
              (err, stream) => {
                if (err) {
                  reject(new Error(`SSH tunnel forwarding failed: ${err.message}`));
                  return;
                }
                console.error(`✅ SSH tunnel established via ${host} -> localhost:${tunnelPort}`);
                resolve();
              }
            );
          });

          this.sshClient!.on('error', (err) => {
            reject(new Error(`SSH connection to ${host} failed: ${err.message}`));
          });

          // Connect to SSH host
          this.sshClient!.connect({
            host: host,
            username: process.env.MCPMEM_SSH_USER || 'pball',
            privateKey: fs.readFileSync(
              process.env.MCPMEM_SSH_KEY_PATH || `${process.env.HOME}/.ssh/id_rsa`
            ),
            keepaliveInterval: 60000,
          });
        });

        // If we get here, tunnel succeeded
        return;
      } catch (error) {
        console.error(`❌ SSH tunnel to ${host} failed: ${error}`);
        await this.cleanupSsh();
        
        // If this was the last host, throw error
        if (host === pgConfig.hosts[pgConfig.hosts.length - 1]) {
          throw new DatabaseConnectionError(
            `All SSH tunnel attempts failed. Tried: ${pgConfig.hosts.join(', ')}`,
            'postgresql'
          );
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    await this.cleanupSsh();
    this.isConnected = false;
  }

  private async cleanupSsh(): Promise<void> {
    if (this.sshClient) {
      this.sshClient.end();
      this.sshClient = null;
      this.localPort = null;
    }
  }

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

  //
  // Core Memory Operations with pgvector
  //

  async storeMemory(
    content: string,
    type: MemoryType,
    metadata: MemoryMetadata,
    projectId: number
  ): Promise<number> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Generate embedding for content
      const vector = await generateEmbedding(content);
      
      // Store memory with vector embedding
      const result = await client.query(`
        INSERT INTO memories (project_id, content, content_type, metadata, embedding)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING memory_id
      `, [
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

  async getMemory(memoryId: number): Promise<Memory | null> {
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

  async getProjectMemories(projectId: number, limit?: number): Promise<Memory[]> {
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
        params.push(limit);
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
    projectId?: number
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
    projectId?: number
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

  async createProject(name: string, description?: string): Promise<number> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO projects (name, description)
        VALUES ($1, $2)
        RETURNING project_id
      `, [name, description || null]);

      return result.rows[0].project_id;
    } finally {
      client.release();
    }
  }

  async getProject(name: string): Promise<{project_id: number; name: string; description?: string} | null> {
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

  async addMemoryTags(memoryId: number, tags: string[]): Promise<void> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const tag of tags) {
        // Insert tag if not exists
        await client.query(`
          INSERT INTO tags (name) VALUES ($1)
          ON CONFLICT (name) DO NOTHING
        `, [tag]);
        
        // Link tag to memory
        await client.query(`
          INSERT INTO memory_tags (memory_id, tag_id)
          SELECT $1, tag_id FROM tags WHERE name = $2
          ON CONFLICT (memory_id, tag_id) DO NOTHING
        `, [memoryId, tag]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMemoryTags(memoryId: number): Promise<string[]> {
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

  //
  // Relationship Management
  //

  async createMemoryRelationship(
    sourceMemoryId: number,
    targetMemoryId: number,
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