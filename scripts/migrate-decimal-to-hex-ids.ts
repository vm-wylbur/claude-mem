#!/usr/bin/env tsx
// Migration script: Convert decimal BigInt memory IDs to hex format
// This is a one-time migration for cleaner hex-based memory IDs

import { config } from 'dotenv';
import { Pool } from 'pg';
import { formatHashForDisplay } from '../src/utils/hash.js';

config();

async function migrateDecimalToHexIds() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔄 Starting migration: decimal BigInt IDs → hex IDs');
    
    // Get all current memory IDs
    const result = await pool.query('SELECT memory_id FROM memories ORDER BY created_at');
    console.log(`📊 Found ${result.rows.length} memories to migrate`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const row of result.rows) {
      const currentId = row.memory_id;
      
      // Check if it's already hex (contains letters a-f)
      if (/[a-f]/i.test(currentId)) {
        console.log(`⏭️  Skipping already-hex ID: ${currentId}`);
        skippedCount++;
        continue;
      }
      
      // Convert decimal BigInt string to hex
      try {
        const hexId = formatHashForDisplay(currentId);
        
        // Update the memory_id in both memories and memory_tags tables
        await pool.query('BEGIN');
        
        // Update memories table
        await pool.query(
          'UPDATE memories SET memory_id = $1 WHERE memory_id = $2',
          [hexId, currentId]
        );
        
        // Update memory_tags table if it exists
        const tagsResult = await pool.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'memory_tags'
          )`
        );
        
        if (tagsResult.rows[0].exists) {
          await pool.query(
            'UPDATE memory_tags SET memory_id = $1 WHERE memory_id = $2',
            [hexId, currentId]
          );
        }
        
        await pool.query('COMMIT');
        
        console.log(`✅ Migrated: ${currentId} → ${hexId}`);
        migratedCount++;
        
      } catch (error) {
        await pool.query('ROLLBACK');
        console.error(`❌ Failed to migrate ${currentId}:`, error);
      }
    }
    
    console.log(`\n🎉 Migration complete!`);
    console.log(`   Migrated: ${migratedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Total: ${result.rows.length}`);
    
  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration immediately
migrateDecimalToHexIds();