#!/usr/bin/env node
// Tag Migration Script: Sequential IDs → Hash-based IDs
// Author: PB and Claude
// Date: 2025-07-02
// License: (c) HRDAG, 2025, GPL-2 or newer

import { createDatabaseAdapterToml } from '../src/config.js';
import { initializeHasher, generateTagHash } from '../src/utils/hash.js';

interface ExistingTag {
  tag_id: number;
  tag_name: string;
  created_at: string;
}

interface TagMapping {
  oldId: number;
  newHashId: string;
  tagName: string;
}

/**
 * Main migration function
 */
async function migrateTags(): Promise<void> {
  console.log('Starting tag migration to hash-based IDs...');

  try {
    // Initialize hash utilities
    await initializeHasher();
    console.log('Hash utilities initialized');

    // Connect to database
    const adapter = await createDatabaseAdapterToml();
    console.log('Database connection established');

    // Execute PostgreSQL migration
    await migratePostgreSQLTags(adapter);

    console.log('Tag migration completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

/**
 * Migrate PostgreSQL tags to hash-based IDs
 */
async function migratePostgreSQLTags(adapter: any): Promise<void> {
  const client = await adapter.pool.connect();

  try {
    console.log('Starting PostgreSQL tag migration...');

    await client.query('BEGIN');

    // 1. Get existing tags
    const existingTagsResult = await client.query(`
      SELECT tag_id, tag_name, created_at
      FROM tags
      ORDER BY tag_id
    `);

    const existingTags = existingTagsResult.rows as ExistingTag[];
    console.log(`Found ${existingTags.length} existing tags`);

    if (existingTags.length === 0) {
      console.log('No tags found to migrate');
      await client.query('ROLLBACK');
      return;
    }

    // 2. Generate hash mappings
    const tagMappings: TagMapping[] = [];
    const hashIdCheck = new Set<string>();

    for (const tag of existingTags) {
      const tagName = tag.tag_name;
      const hashId = generateTagHash(tagName);

      // Check for hash collisions (extremely unlikely)
      if (hashIdCheck.has(hashId)) {
        throw new Error(`Hash collision detected for tag: ${tagName}`);
      }
      hashIdCheck.add(hashId);

      tagMappings.push({
        oldId: tag.tag_id,
        newHashId: hashId,
        tagName: tagName
      });
    }

    console.log('Generated hash mappings for all tags');

    // 3. Create new tables with hash-based structure
    console.log('Creating new table structures...');

    await client.query(`
      CREATE TABLE tags_new (
        tag_id TEXT PRIMARY KEY,
        tag_name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE memory_tags_new (
        memory_id TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags_new(tag_id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (memory_id, tag_id)
      )
    `);

    // 4. Migrate tag data
    console.log('Migrating tag definitions...');

    for (const mapping of tagMappings) {
      await client.query(`
        INSERT INTO tags_new (tag_id, tag_name, created_at)
        SELECT $1, $2, created_at
        FROM tags WHERE tag_id = $3
      `, [mapping.newHashId, mapping.tagName, mapping.oldId]);
    }

    // 5. Migrate memory-tag relationships
    console.log('Migrating memory-tag relationships...');

    for (const mapping of tagMappings) {
      await client.query(`
        INSERT INTO memory_tags_new (memory_id, tag_id, created_at)
        SELECT memory_id, $1, created_at
        FROM memory_tags WHERE tag_id = $2
      `, [mapping.newHashId, mapping.oldId]);
    }

    // 6. Add indexes to new tables
    console.log('Creating indexes...');

    await client.query('CREATE INDEX idx_tags_new_name ON tags_new(tag_name)');
    await client.query('CREATE INDEX idx_tags_new_created_at ON tags_new(created_at DESC)');
    await client.query('CREATE INDEX idx_memory_tags_new_memory ON memory_tags_new(memory_id)');
    await client.query('CREATE INDEX idx_memory_tags_new_tag ON memory_tags_new(tag_id)');
    await client.query('CREATE INDEX idx_memory_tags_new_created_at ON memory_tags_new(created_at DESC)');

    // 7. Verify migration integrity
    console.log('Verifying migration integrity...');

    const oldTagCount = existingTags.length;
    const newTagCountResult = await client.query('SELECT COUNT(*) as count FROM tags_new');
    const newTagCount = parseInt(newTagCountResult.rows[0].count);

    if (oldTagCount !== newTagCount) {
      throw new Error(`Tag count mismatch: ${oldTagCount} → ${newTagCount}`);
    }

    const oldRelationCountResult = await client.query('SELECT COUNT(*) as count FROM memory_tags');
    const newRelationCountResult = await client.query('SELECT COUNT(*) as count FROM memory_tags_new');
    const oldRelationCount = parseInt(oldRelationCountResult.rows[0].count);
    const newRelationCount = parseInt(newRelationCountResult.rows[0].count);

    if (oldRelationCount !== newRelationCount) {
      throw new Error(`Relationship count mismatch: ${oldRelationCount} → ${newRelationCount}`);
    }

    console.log('Migration integrity verified');

    // 8. Drop old tables and rename new ones
    console.log('Swapping table structures...');

    await client.query('DROP TABLE memory_tags CASCADE');
    await client.query('DROP TABLE tags CASCADE');
    await client.query('ALTER TABLE tags_new RENAME TO tags');
    await client.query('ALTER TABLE memory_tags_new RENAME TO memory_tags');

    await client.query('COMMIT');
    console.log('PostgreSQL tag migration completed successfully');

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateTags().catch(console.error);
}

export { migrateTags };
