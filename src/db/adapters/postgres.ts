// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/adapters/postgres.ts

import pg from 'pg';
import fs from 'fs';
// Removed: SSH tunnel imports no longer needed
import {
  DatabaseAdapter,
  DatabaseConfig,
  DatabaseConnectionError,
  DatabaseConnectionInfo,
  QueueFix,
  QueueFixConsumedOutcome,
  QueueFixFilter,
  QueueFixInput,
} from './base.js';
import { MemoryType, MemoryMetadata, Memory } from '../service.js';
import { generateEmbedding, generateEmbeddingWithFallback } from '../../embeddings.js';
import { generateMemoryHash, generateTagHash, initializeHasher } from '../../utils/hash.js';

const { Pool } = pg;

/**
 * PostgreSQL Database Adapter Implementation with pgvector support
 * 
 * Provides PostgreSQL backend for the memory management system with native vector
 * similarity search using pgvector extension. Connects directly to PostgreSQL.
 *
 * @features
 * - Native pgvector similarity search (cosine distance)
 * - Direct connection to self-hosted PostgreSQL
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

  // Removed: establishSshTunnel() method - no longer needed

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

  // Removed: cleanupSsh() method - no longer needed

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
    projectId: string,
    sourceKey?: string
  ): Promise<string> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Generate embedding for content with fallback. Recomputed every call,
      // so a keyed update re-embeds the new content.
      const vector = await generateEmbeddingWithFallback(content);
      const embedding = vector ? JSON.stringify(vector) : null; // JSONB array for pgvector, or null
      const metadataJson = JSON.stringify(metadata);

      let result;
      if (sourceKey) {
        // Keyed upsert. memory_id is derived from the source_key (not the
        // content) so it stays stable across edits — re-storing an edited
        // memory file updates the SAME row (content/type/metadata/embedding
        // refreshed) instead of inserting a new content-hash row. Keying the
        // PK on source_key also avoids colliding with content-hash ids.
        const memoryId = generateMemoryHash(sourceKey, 'source-key');
        result = await client.query(`
          INSERT INTO memories (memory_id, project_id, content, content_type, metadata, embedding, source_key)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET
            content = EXCLUDED.content,
            content_type = EXCLUDED.content_type,
            metadata = EXCLUDED.metadata,
            embedding = EXCLUDED.embedding,
            updated_at = CURRENT_TIMESTAMP
          RETURNING memory_id
        `, [memoryId, projectId, content, type, metadataJson, embedding, sourceKey]);
      } else {
        // Unkeyed: original content-hash dedup behavior, unchanged.
        const memoryId = generateMemoryHash(content, type);
        result = await client.query(`
          INSERT INTO memories (memory_id, project_id, content, content_type, metadata, embedding)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (memory_id) DO UPDATE SET
            updated_at = CURRENT_TIMESTAMP
          RETURNING memory_id
        `, [memoryId, projectId, content, type, metadataJson, embedding]);
      }

      await client.query('COMMIT');
      return result.rows[0].memory_id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async storeMemoryWithEmbeddingStatus(
    content: string,
    type: MemoryType,
    metadata: MemoryMetadata,
    projectId: string
  ): Promise<{memoryId: string; hasEmbedding: boolean}> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Generate hash-based memory ID
      const memoryId = generateMemoryHash(content, type);

      // Generate embedding for content with fallback
      const vector = await generateEmbeddingWithFallback(content);
      
      // Store memory with hash ID and optional vector embedding
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
        vector ? JSON.stringify(vector) : null
      ]);

      await client.query('COMMIT');
      return {
        memoryId: result.rows[0].memory_id,
        hasEmbedding: vector !== null
      };
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
      let whereClause = 'WHERE embedding IS NOT NULL';
      let params: any[] = [JSON.stringify(queryVector), limit];
      
      if (projectId) {
        whereClause += ' AND project_id = $3';
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

      // Pre-validate all tags and check for existing ones
      const existingTags: string[] = [];
      const tagInfo: Array<{name: string, tagId: string, exists: boolean}> = [];

      for (const tagName of tags) {
        // Validate tag name first
        const validation = await this.validateTagNameForDatabase(tagName);
        if (!validation.valid) {
          throw new Error(`Invalid tag name "${tagName}": ${validation.error}`);
        }

        // Check if tag already exists
        const existingTag = await client.query(`
          SELECT tag_id FROM tags WHERE name = $1
        `, [tagName]);
        
        if (existingTag.rows.length > 0) {
          // Tag exists
          tagInfo.push({
            name: tagName,
            tagId: existingTag.rows[0].tag_id,
            exists: true
          });
          existingTags.push(tagName);
        } else {
          // Tag is new
          const tagId = generateTagHash(tagName);
          tagInfo.push({
            name: tagName,
            tagId: tagId,
            exists: false
          });
        }
      }

      // Create new tags
      for (const tag of tagInfo.filter(t => !t.exists)) {
        try {
          await client.query(`
            INSERT INTO tags (tag_id, name) VALUES ($1, $2)
          `, [tag.tagId, tag.name]);
        } catch (error: any) {
          if (error.code === '23505') { // PostgreSQL unique constraint violation
            throw new Error(`Tag '${tag.name}' already exists (created by another process)`);
          }
          throw error;
        }
      }
      
      // Link all tags to memory
      for (const tag of tagInfo) {
        try {
          await client.query(`
            INSERT INTO memory_tags (memory_id, tag_id)
            VALUES ($1, $2)
            ON CONFLICT (memory_id, tag_id) DO NOTHING
          `, [memoryId, tag.tagId]);
        } catch (error: any) {
          if (error.code === '23503') { // PostgreSQL foreign key constraint violation
            throw new Error(`Memory with ID '${memoryId}' does not exist`);
          }
          throw error;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async validateTagNameForDatabase(tagName: string): Promise<{valid: boolean, error: string | null}> {
    // Import validation function dynamically to avoid circular imports
    const { validateTagName } = await import('../../utils/hash.js');
    return validateTagName(tagName);
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

  //
  // IaC Drift Queue (queue_fixes)
  //

  async createQueueFix(input: QueueFixInput): Promise<number> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          INSERT INTO queue_fixes (
            target_repo, host, path,
            before_state, after_state, why,
            suggested_role, who, trust, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `,
        [
          input.target_repo,
          input.host,
          input.path,
          input.before_state ?? null,
          input.after_state,
          input.why,
          input.suggested_role ?? null,
          input.who,
          input.trust ?? null,
          input.metadata ?? {},
        ]
      );
      return Number(result.rows[0].id);
    } finally {
      client.release();
    }
  }

  async listQueueFixes(filter: QueueFixFilter): Promise<QueueFix[]> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const conds: string[] = [];
    const params: any[] = [];
    if (filter.target_repo !== undefined) {
      params.push(filter.target_repo);
      conds.push(`target_repo = $${params.length}`);
    }
    if (filter.status !== undefined) {
      params.push(filter.status);
      conds.push(`status = $${params.length}`);
    }
    if (filter.host !== undefined) {
      params.push(filter.host);
      conds.push(`host = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    let limitClause = '';
    if (filter.limit !== undefined) {
      params.push(filter.limit);
      limitClause = `LIMIT $${params.length}`;
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          SELECT
            id, target_repo, host, path,
            before_state, after_state, why,
            suggested_role, who, trust, status,
            created_at, updated_at,
            consumed_at, consumed_by_commit, consumed_in_repo, consumed_in_path,
            escalation_reason, superseded_by, metadata
          FROM queue_fixes
          ${where}
          ORDER BY created_at ASC
          ${limitClause}
        `,
        params
      );
      return result.rows.map(this.queueFixRow);
    } finally {
      client.release();
    }
  }

  async markQueueFixConsumed(id: number, outcome: QueueFixConsumedOutcome): Promise<void> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          UPDATE queue_fixes
          SET status = 'consumed',
              consumed_at = CURRENT_TIMESTAMP,
              consumed_by_commit = $2,
              consumed_in_repo = $3,
              consumed_in_path = $4,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'open'
        `,
        [id, outcome.commit, outcome.repo, outcome.path]
      );
      if (result.rowCount === 0) {
        throw new Error(`queue_fix ${id} not found or not open`);
      }
    } finally {
      client.release();
    }
  }

  async markQueueFixEscalated(id: number, reason: string): Promise<void> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          UPDATE queue_fixes
          SET status = 'escalated',
              escalation_reason = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'open'
        `,
        [id, reason]
      );
      if (result.rowCount === 0) {
        throw new Error(`queue_fix ${id} not found or not open`);
      }
    } finally {
      client.release();
    }
  }

  async markQueueFixSuperseded(id: number, supersededBy: number): Promise<void> {
    if (!this.pool) throw new DatabaseConnectionError('Not connected', 'postgresql');

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          UPDATE queue_fixes
          SET status = 'superseded',
              superseded_by = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'open'
        `,
        [id, supersededBy]
      );
      if (result.rowCount === 0) {
        throw new Error(`queue_fix ${id} not found or not open`);
      }
    } finally {
      client.release();
    }
  }

  private queueFixRow = (row: any): QueueFix => ({
    id: Number(row.id),
    target_repo: row.target_repo,
    host: row.host,
    path: row.path,
    before_state: row.before_state,
    after_state: row.after_state,
    why: row.why,
    suggested_role: row.suggested_role,
    who: row.who,
    trust: row.trust,
    status: row.status,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    consumed_at:
      row.consumed_at instanceof Date ? row.consumed_at.toISOString() : row.consumed_at,
    consumed_by_commit: row.consumed_by_commit,
    consumed_in_repo: row.consumed_in_repo,
    consumed_in_path: row.consumed_in_path,
    escalation_reason: row.escalation_reason,
    superseded_by: row.superseded_by !== null ? Number(row.superseded_by) : null,
    metadata: row.metadata ?? {},
  });
}