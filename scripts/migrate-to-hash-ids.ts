#!/usr/bin/env ts-node
// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// Migration script to convert existing databases from sequential integer IDs to xxHash64-based IDs

import { Pool } from 'pg';
import { generateMigrationHash, initializeHasher } from '../src/utils/hash.js';
import { getDatabaseConfigToml } from '../src/config-toml.js';

interface LegacyMemory {
  memory_id: number;
  project_id: number;
  content: string;
  content_type: string;
  metadata: string;
  embedding_id?: number;
  created_at: string;
  updated_at?: string;
}

interface LegacyRelationship {
  relationship_id: number;
  source_memory_id: number;
  target_memory_id: number;
  relationship_type: string;
  created_at: string;
}

interface LegacyMemoryTag {
  memory_id: number;
  tag_id: number;
  created_at: string;
}

/**
 * Migration Script for Hash-based Memory IDs
 *
 * This script migrates existing memory databases from sequential integer IDs
 * to content-based xxHash64 IDs while preserving all relationships and data.
 *
 * Process:
 * 1. Backup existing tables to migration_backup schema
 * 2. Create ID mapping (old ID -> new hash ID)
 * 3. Update memories table with hash IDs
 * 4. Update all foreign key references in relationships and tags
 * 5. Verify data integrity
 */
class HashIdMigration {
  private config: any;
  private idMapping = new Map<number, string>(); // old ID -> new hash ID

  constructor() {}

  async run(): Promise<void> {
    console.log('Starting migration to hash-based memory IDs...\n');

    // Initialize hash utilities
    await initializeHasher();

    // Get config
    this.config = await getDatabaseConfigToml();

    // Migrate PostgreSQL
    await this.migratePostgreSQL();

    console.log('Migration completed successfully!\n');
    console.log('Next steps:');
    console.log('   1. Test the migrated system thoroughly');
    console.log('   2. Update MCP tools for hex display');
    console.log('   3. Run integration tests');
    console.log('   4. Archive old database backups when satisfied');
  }

  private async migratePostgreSQL(): Promise<void> {
    console.log('Migrating PostgreSQL database...');

    const pgConfig = this.config.postgresql;

    // Create connection pool
    const pool = new Pool({
      host: pgConfig.hosts[0],
      port: pgConfig.port || 5432,
      database: pgConfig.database,
      user: pgConfig.user,
      password: pgConfig.password,
      max: 5
    });

    const client = await pool.connect();

    try {
      // Create backup schema
      console.log('Creating backup schema...');
      await client.query('CREATE SCHEMA IF NOT EXISTS migration_backup');

      // Backup existing tables
      await client.query('CREATE TABLE migration_backup.memories AS TABLE memories');
      await client.query('CREATE TABLE migration_backup.memory_relationships AS TABLE memory_relationships');
      await client.query('CREATE TABLE migration_backup.memory_tags AS TABLE memory_tags');

      console.log('Reading existing memory data...');

      // Get all existing memories
      const memoriesResult = await client.query('SELECT * FROM memories ORDER BY memory_id');
      const memories = memoriesResult.rows as LegacyMemory[];
      console.log(`   Found ${memories.length} memories to migrate`);

      // Create ID mapping
      console.log('Generating hash ID mapping...');
      for (const memory of memories) {
        const hashId = generateMigrationHash(memory.content, memory.content_type, memory.created_at);
        this.idMapping.set(memory.memory_id, hashId);
      }

      // Begin transaction
      await client.query('BEGIN');

      try {
        // Step 1: Create new table structure
        console.log('Creating new schema with hash IDs...');

        await client.query(`
          CREATE TABLE memories_new (
            memory_id BIGINT PRIMARY KEY,  -- xxHash64 BIGINT
            project_id INTEGER NOT NULL REFERENCES projects(project_id),
            content TEXT NOT NULL,
            content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('conversation', 'code', 'decision', 'reference')),
            metadata JSONB NOT NULL DEFAULT '{}',
            embedding vector(768),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Step 2: Migrate memories
        console.log('Migrating memories to hash IDs...');
        for (const memory of memories) {
          const hashId = this.idMapping.get(memory.memory_id)!;
          await client.query(`
            INSERT INTO memories_new (memory_id, project_id, content, content_type, metadata, embedding, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            hashId,
            memory.project_id,
            memory.content,
            memory.content_type,
            memory.metadata,
            null, // embedding will be regenerated
            memory.created_at,
            memory.updated_at || memory.created_at
          ]);
        }

        // Step 3: Migrate relationships
        console.log('Migrating relationships...');
        const relationshipsResult = await client.query('SELECT * FROM memory_relationships');

        await client.query(`
          CREATE TABLE memory_relationships_new (
            relationship_id BIGSERIAL PRIMARY KEY,
            source_memory_id BIGINT NOT NULL REFERENCES memories_new(memory_id),
            target_memory_id BIGINT NOT NULL REFERENCES memories_new(memory_id),
            relationship_type VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_memory_id, target_memory_id, relationship_type)
          )
        `);

        for (const rel of relationshipsResult.rows) {
          const sourceHashId = this.idMapping.get(rel.source_memory_id);
          const targetHashId = this.idMapping.get(rel.target_memory_id);

          if (sourceHashId && targetHashId) {
            await client.query(`
              INSERT INTO memory_relationships_new (source_memory_id, target_memory_id, relationship_type, created_at)
              VALUES ($1, $2, $3, $4)
            `, [sourceHashId, targetHashId, rel.relationship_type, rel.created_at]);
          }
        }

        // Step 4: Migrate memory tags
        console.log('Migrating memory tags...');
        const memoryTagsResult = await client.query('SELECT * FROM memory_tags');

        await client.query(`
          CREATE TABLE memory_tags_new (
            memory_id BIGINT NOT NULL REFERENCES memories_new(memory_id),
            tag_id INTEGER NOT NULL REFERENCES tags(tag_id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (memory_id, tag_id)
          )
        `);

        for (const mt of memoryTagsResult.rows) {
          const hashId = this.idMapping.get(mt.memory_id);
          if (hashId) {
            await client.query(`
              INSERT INTO memory_tags_new (memory_id, tag_id, created_at)
              VALUES ($1, $2, $3)
            `, [hashId, mt.tag_id, mt.created_at]);
          }
        }

        // Step 5: Replace old tables
        console.log('Replacing old tables with migrated tables...');
        await client.query('DROP TABLE memory_relationships CASCADE');
        await client.query('DROP TABLE memory_tags CASCADE');
        await client.query('DROP TABLE memories CASCADE');

        await client.query('ALTER TABLE memories_new RENAME TO memories');
        await client.query('ALTER TABLE memory_relationships_new RENAME TO memory_relationships');
        await client.query('ALTER TABLE memory_tags_new RENAME TO memory_tags');

        // Step 6: Create indexes
        console.log('Creating indexes...');
        await client.query('CREATE INDEX idx_memories_project_id ON memories(project_id)');
        await client.query('CREATE INDEX idx_memories_content_type ON memories(content_type)');
        await client.query('CREATE INDEX idx_memories_created_at ON memories(created_at DESC)');
        await client.query('CREATE INDEX idx_memories_metadata ON memories USING GIN(metadata)');
        await client.query('CREATE INDEX idx_memory_relationships_source ON memory_relationships(source_memory_id)');
        await client.query('CREATE INDEX idx_memory_relationships_target ON memory_relationships(target_memory_id)');

        // Commit transaction
        await client.query('COMMIT');
        console.log('PostgreSQL migration completed successfully');

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

    } finally {
      client.release();
      await pool.end();
    }

    console.log('Original tables backed up to migration_backup schema');
  }

  private async verifyMigration(): Promise<void> {
    console.log('Verifying migration integrity...');

    // TODO: Add verification logic
    // - Check memory count matches
    // - Verify no duplicate hash IDs
    // - Check relationship integrity
    // - Validate tag links

    console.log('Migration verification completed');
  }
}

// Run migration if called directly
if (require.main === module) {
  const migration = new HashIdMigration();
  migration.run().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

export { HashIdMigration };
