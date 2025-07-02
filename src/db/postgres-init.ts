// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/postgres-init.ts

import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseConfig } from './adapters/base.js';
import { PostgresAdapter } from './adapters/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

/**
 * Initialize PostgreSQL database with schema and pgvector extension
 * 
 * This function handles the complete setup of a PostgreSQL database for
 * the memory management system, including:
 * - Creating the database if it doesn't exist
 * - Installing pgvector extension
 * - Creating all required tables and indexes
 * - Setting up development project
 */
export async function initializePostgresDatabase(config: DatabaseConfig): Promise<void> {
  if (config.type !== 'postgresql' || !config.postgresql) {
    throw new Error('Invalid PostgreSQL configuration');
  }

  console.error('🚀 Initializing PostgreSQL database...');

  // Create adapter to handle connection (including SSH tunnel)
  const adapter = new PostgresAdapter(config);
  
  try {
    // Connect with tunnel if needed
    await adapter.connect();
    
    // Get the underlying pool for schema operations
    const pool = (adapter as any).pool as pg.Pool;
    const client = await pool.connect();
    
    try {
      console.error('📄 Loading PostgreSQL schema...');
      
      // Load schema file
      const schemaPath = path.join(__dirname, 'postgres-schema.sql');
      const schema = await fs.readFile(schemaPath, 'utf-8');
      
      console.error('⚡ Executing schema...');
      
      // Execute schema (this will create tables, indexes, and extensions)
      await client.query(schema);
      
      console.error('✅ PostgreSQL database initialized successfully');
      
      // Verify pgvector extension
      const extensionCheck = await client.query(`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `);
      
      if (extensionCheck.rows.length > 0) {
        console.error(`✅ pgvector extension installed (version: ${extensionCheck.rows[0].extversion})`);
      } else {
        console.error('⚠️  pgvector extension not found - vector operations will fail');
      }
      
      // Verify tables were created
      const tableCheck = await client.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('projects', 'memories', 'tags', 'memory_tags', 'memory_relationships')
        ORDER BY table_name
      `);
      
      console.error(`✅ Created ${tableCheck.rows.length} tables:`, 
        tableCheck.rows.map(r => r.table_name).join(', '));
      
      // Check if development project exists
      const devProjectCheck = await client.query(`
        SELECT project_id FROM projects WHERE name = 'memory-mcp-development'
      `);
      
      if (devProjectCheck.rows.length > 0) {
        console.error(`✅ Development project exists (ID: ${devProjectCheck.rows[0].project_id})`);
      }
      
    } finally {
      client.release();
    }
    
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Create a new PostgreSQL database (requires superuser privileges)
 * This is a separate function because it needs to connect to the postgres database first
 */
export async function createPostgresDatabase(
  host: string,
  port: number,
  user: string,
  password: string,
  databaseName: string
): Promise<void> {
  console.error(`🏗️  Creating database '${databaseName}'...`);
  
  // Connect to default postgres database to create new database
  const pool = new Pool({
    host,
    port,
    database: 'postgres', // Connect to default database
    user,
    password,
  });
  
  try {
    const client = await pool.connect();
    try {
      // Check if database exists
      const dbCheck = await client.query(`
        SELECT 1 FROM pg_database WHERE datname = $1
      `, [databaseName]);
      
      if (dbCheck.rows.length === 0) {
        // Create database
        await client.query(`CREATE DATABASE "${databaseName}"`);
        console.error(`✅ Database '${databaseName}' created successfully`);
      } else {
        console.error(`✅ Database '${databaseName}' already exists`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}