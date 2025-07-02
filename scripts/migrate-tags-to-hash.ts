#!/usr/bin/env node
// Tag Migration Script: Sequential IDs → Hash-based IDs
// Author: PB and Claude
// Date: 2025-07-02
// License: (c) HRDAG, 2025, GPL-2 or newer

import { createDatabaseAdapterToml } from '../src/config.js';
import { initializeHasher, generateTagHash } from '../src/utils/hash.js';

interface ExistingTag {
  tag_id: number;
  tag_name?: string;  // PostgreSQL
  name?: string;      // SQLite
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
  console.log('🚀 Starting tag migration to hash-based IDs...');
  
  try {
    // Initialize hash utilities
    await initializeHasher();
    console.log('✅ Hash utilities initialized');
    
    // Connect to database
    const adapter = await createDatabaseAdapterToml();
    console.log('✅ Database connection established');
    
    // Determine database type and execute appropriate migration
    const dbType = await getDatabaseType(adapter);
    console.log(`📊 Database type detected: ${dbType}`);
    
    if (dbType === 'postgresql') {
      await migratePostgreSQLTags(adapter);
    } else if (dbType === 'sqlite') {
      await migrateSQLiteTags(adapter);
    } else {
      throw new Error(`Unsupported database type: ${dbType}`);
    }
    
    console.log('🎉 Tag migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

/**
 * Detect database type from adapter
 */
async function getDatabaseType(adapter: any): Promise<string> {
  // Check for PostgreSQL-specific properties/methods
  if (adapter.pool) return 'postgresql';
  if (adapter.db) return 'sqlite';
  
  throw new Error('Unable to determine database type');
}

/**
 * Migrate PostgreSQL tags to hash-based IDs
 */
async function migratePostgreSQLTags(adapter: any): Promise<void> {
  const client = await adapter.pool.connect();
  
  try {
    console.log('🔄 Starting PostgreSQL tag migration...');
    
    await client.query('BEGIN');
    
    // 1. Get existing tags
    const existingTagsResult = await client.query(`
      SELECT tag_id, tag_name, created_at 
      FROM tags 
      ORDER BY tag_id
    `);
    
    const existingTags = existingTagsResult.rows as ExistingTag[];
    console.log(`📋 Found ${existingTags.length} existing tags`);
    
    if (existingTags.length === 0) {
      console.log('⚠️  No tags found to migrate');
      await client.query('ROLLBACK');
      return;
    }
    
    // 2. Generate hash mappings
    const tagMappings: TagMapping[] = [];
    const hashIdCheck = new Set<string>();
    
    for (const tag of existingTags) {
      const tagName = tag.tag_name!;
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
    
    console.log('🔨 Generated hash mappings for all tags');
    
    // 3. Create new tables with hash-based structure
    console.log('📦 Creating new table structures...');
    
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
    console.log('📊 Migrating tag definitions...');
    
    for (const mapping of tagMappings) {
      await client.query(`
        INSERT INTO tags_new (tag_id, tag_name, created_at)
        SELECT $1, $2, created_at
        FROM tags WHERE tag_id = $3
      `, [mapping.newHashId, mapping.tagName, mapping.oldId]);
    }
    
    // 5. Migrate memory-tag relationships
    console.log('🔗 Migrating memory-tag relationships...');
    
    for (const mapping of tagMappings) {
      await client.query(`
        INSERT INTO memory_tags_new (memory_id, tag_id, created_at)
        SELECT memory_id, $1, created_at
        FROM memory_tags WHERE tag_id = $2
      `, [mapping.newHashId, mapping.oldId]);
    }
    
    // 6. Add indexes to new tables
    console.log('🏗️  Creating indexes...');
    
    await client.query('CREATE INDEX idx_tags_new_name ON tags_new(tag_name)');
    await client.query('CREATE INDEX idx_tags_new_created_at ON tags_new(created_at DESC)');
    await client.query('CREATE INDEX idx_memory_tags_new_memory ON memory_tags_new(memory_id)');
    await client.query('CREATE INDEX idx_memory_tags_new_tag ON memory_tags_new(tag_id)');
    await client.query('CREATE INDEX idx_memory_tags_new_created_at ON memory_tags_new(created_at DESC)');
    
    // 7. Verify migration integrity
    console.log('🔍 Verifying migration integrity...');
    
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
    
    console.log('✅ Migration integrity verified');
    
    // 8. Drop old tables and rename new ones
    console.log('🔄 Swapping table structures...');
    
    await client.query('DROP TABLE memory_tags CASCADE');
    await client.query('DROP TABLE tags CASCADE');
    await client.query('ALTER TABLE tags_new RENAME TO tags');
    await client.query('ALTER TABLE memory_tags_new RENAME TO memory_tags');
    
    await client.query('COMMIT');
    console.log('✅ PostgreSQL tag migration completed successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Migrate SQLite tags to hash-based IDs
 */
async function migrateSQLiteTags(adapter: any): Promise<void> {
  console.log('🔄 Starting SQLite tag migration...');
  
  if (!adapter.db) {
    throw new Error('SQLite database not connected');
  }
  
  // SQLite doesn't support transactions across schema changes as cleanly
  // We'll use a different approach: backup, recreate, restore
  
  try {
    // 1. Get existing tags
    const existingTags = adapter.db.prepare(`
      SELECT tag_id, name, rowid
      FROM tags 
      ORDER BY tag_id
    `).all() as ExistingTag[];
    
    console.log(`📋 Found ${existingTags.length} existing tags`);
    
    if (existingTags.length === 0) {
      console.log('⚠️  No tags found to migrate');
      return;
    }
    
    // 2. Generate hash mappings
    const tagMappings: TagMapping[] = [];
    const hashIdCheck = new Set<string>();
    
    for (const tag of existingTags) {
      const tagName = tag.name!;  // SQLite uses 'name' column
      const hashId = generateTagHash(tagName);
      
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
    
    console.log('🔨 Generated hash mappings for all tags');
    
    // 3. Get existing memory-tag relationships
    const existingRelations = adapter.db.prepare(`
      SELECT memory_id, tag_id
      FROM memory_tags
    `).all();
    
    console.log(`🔗 Found ${existingRelations.length} memory-tag relationships`);
    
    // 4. Create mapping for relationships
    const relationMappings = existingRelations.map((rel: any) => {
      const tagMapping = tagMappings.find(m => m.oldId === rel.tag_id);
      if (!tagMapping) {
        throw new Error(`No mapping found for tag_id: ${rel.tag_id}`);
      }
      
      return {
        memory_id: rel.memory_id,
        new_tag_id: tagMapping.newHashId
      };
    });
    
    // 5. Drop existing tables
    console.log('🗑️  Dropping old table structures...');
    adapter.db.exec('DROP TABLE memory_tags');
    adapter.db.exec('DROP TABLE tags');
    
    // 6. Create new hash-based tables
    console.log('📦 Creating new hash-based table structures...');
    
    adapter.db.exec(`
      CREATE TABLE tags (
        tag_id TEXT PRIMARY KEY,
        tag_name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    adapter.db.exec(`
      CREATE TABLE memory_tags (
        memory_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (memory_id, tag_id),
        FOREIGN KEY (memory_id) REFERENCES memories(memory_id),
        FOREIGN KEY (tag_id) REFERENCES tags(tag_id)
      )
    `);
    
    // 7. Insert tags with hash IDs
    console.log('📊 Inserting tags with hash IDs...');
    
    const insertTag = adapter.db.prepare(`
      INSERT INTO tags (tag_id, tag_name, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    
    for (const mapping of tagMappings) {
      insertTag.run(mapping.newHashId, mapping.tagName);
    }
    
    // 8. Insert memory-tag relationships with hash IDs
    console.log('🔗 Inserting memory-tag relationships...');
    
    const insertRelation = adapter.db.prepare(`
      INSERT INTO memory_tags (memory_id, tag_id, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    
    for (const relation of relationMappings) {
      insertRelation.run(relation.memory_id, relation.new_tag_id);
    }
    
    // 9. Create indexes
    console.log('🏗️  Creating indexes...');
    
    adapter.db.exec('CREATE INDEX idx_tags_name ON tags(tag_name)');
    adapter.db.exec('CREATE INDEX idx_tags_created_at ON tags(created_at DESC)');
    adapter.db.exec('CREATE INDEX idx_memory_tags_memory ON memory_tags(memory_id)');
    adapter.db.exec('CREATE INDEX idx_memory_tags_tag ON memory_tags(tag_id)');
    
    // 10. Verify migration
    console.log('🔍 Verifying migration integrity...');
    
    const newTagCount = adapter.db.prepare('SELECT COUNT(*) as count FROM tags').get().count;
    const newRelationCount = adapter.db.prepare('SELECT COUNT(*) as count FROM memory_tags').get().count;
    
    if (existingTags.length !== newTagCount) {
      throw new Error(`Tag count mismatch: ${existingTags.length} → ${newTagCount}`);
    }
    
    if (existingRelations.length !== newRelationCount) {
      throw new Error(`Relationship count mismatch: ${existingRelations.length} → ${newRelationCount}`);
    }
    
    console.log('✅ SQLite tag migration completed successfully');
    
  } catch (error) {
    console.error('❌ SQLite migration error:', error);
    throw error;
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateTags().catch(console.error);
}

export { migrateTags };