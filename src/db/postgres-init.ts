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

  const pgConfig = config.postgresql;

  // Use a RAW pool, not PostgresAdapter.connect(): the adapter's connect()
  // asserts the core tables (and pgvector) already exist and throws otherwise
  // -- a runtime-readiness guard. Routing init through it is a chicken-and-egg
  // bug: a fresh/empty DB can never be initialized because the very tables init
  // creates are required before it runs (claude-mem #7). The base schema's
  // `CREATE EXTENSION IF NOT EXISTS vector` + table DDL run fine on a raw
  // connection.
  const pool = new Pool({
    host: pgConfig.hosts[0],
    port: pgConfig.port || 5432,
    database: pgConfig.database,
    user: pgConfig.user,
    password: pgConfig.password,
    ssl: pgConfig.sslmode ? { rejectUnauthorized: false } : false,
    max: pgConfig.max_connections || 5,
    connectionTimeoutMillis: pgConfig.connection_timeout_ms || 5000,
  });

  // An 'error' event on an idle pooled client with no listener is an unhandled
  // EventEmitter error -> process crash. Mirror the adapter's handler so a
  // mid-init connection drop logs instead of aborting the Node process.
  pool.on('error', (err) => {
    console.error('📊 Database pool error during init (connection drop):', err.message);
  });

  try {
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

      // Apply versioned migrations on top of the base schema. The base schema
      // is the table-of-record snapshot; migrations/*.sql carry additive,
      // post-snapshot changes (e.g. 001_hybrid_search.sql defines
      // search_hybrid(), which the /search path calls at runtime). Without
      // this, a fresh init produced a DB missing search_hybrid -> /search
      // threw "function search_hybrid(...) does not exist" (claude-mem #7).
      await applyMigrations(client);

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
    await pool.end();
  }
}

/**
 * Apply versioned SQL migrations from src/db/migrations/ on top of the base
 * schema. Each migration file is applied at most once, tracked by filename in a
 * schema_migrations table, in lexical (zero-padded numeric prefix) order. Each
 * file runs in its own transaction so a failure rolls back cleanly and is not
 * recorded -- re-running init then retries it. The migration files are written
 * to be idempotent regardless (IF NOT EXISTS / OR REPLACE), so this tracking is
 * a guard against needless re-execution, not the sole correctness mechanism.
 */
async function applyMigrations(client: pg.PoolClient): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');

  let files: string[];
  try {
    files = (await fs.readdir(migrationsDir))
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      console.error('ℹ️  No migrations directory found - skipping migrations');
      return;
    }
    throw err;
  }

  if (files.length === 0) {
    console.error('ℹ️  No migrations to apply');
    return;
  }

  console.error(`🧭 Applying migrations (${files.length} on disk)...`);

  // Track applied migrations by filename. Created here (not in the base schema)
  // so the runner is self-contained and works against any DB, including one
  // initialized before this table existed.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const appliedResult = await client.query('SELECT filename FROM schema_migrations');
  const applied = new Set<string>(appliedResult.rows.map(r => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.error(`   ⏭  ${file} (already applied)`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      console.error(`   ✅ ${file}`);
    } catch (err) {
      // ROLLBACK in its own try/catch: if the connection dropped during the
      // migration, ROLLBACK throws too and would otherwise mask the real cause.
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error(`   ⚠️  ROLLBACK also failed: ${rollbackErr}`);
      }
      console.error(`   ❌ ${file} failed - rolled back, not recorded`);
      throw err;
    }
  }

  console.error('✅ Migrations applied');
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