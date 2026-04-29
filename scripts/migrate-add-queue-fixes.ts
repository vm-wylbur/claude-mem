#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2026-04-29
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// scripts/migrate-add-queue-fixes.ts
//
// Idempotent migration to add the queue_fixes table + indexes to a
// running claude-mem PostgreSQL database. Safe to re-run.
//
// Usage:
//   MCPMEM_DB_TYPE=postgresql npx tsx scripts/migrate-add-queue-fixes.ts
//
// Reads connection from ~/.config/claude-mem/claude-mem.toml (same as the
// running server). Does NOT touch any existing tables.
//
// Rollback:
//   DROP TABLE IF EXISTS queue_fixes;
// (No FK dependencies from other tables to queue_fixes — safe to drop.)

import { config } from 'dotenv';
import pg from 'pg';
import { getDatabaseConfigToml } from '../src/config-toml.js';

config();

const MIGRATION_SQL = `
-- queue_fixes table
CREATE TABLE IF NOT EXISTS queue_fixes (
    id BIGSERIAL PRIMARY KEY,
    target_repo TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    before_state TEXT,
    after_state TEXT NOT NULL,
    why TEXT NOT NULL,
    suggested_role TEXT,
    who TEXT NOT NULL,
    trust TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'consumed', 'escalated', 'superseded')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    consumed_at TIMESTAMP,
    consumed_by_commit TEXT,
    consumed_in_repo TEXT,
    consumed_in_path TEXT,
    escalation_reason TEXT,
    superseded_by BIGINT REFERENCES queue_fixes(id),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_qf_target_status_created
    ON queue_fixes(target_repo, status, created_at);
CREATE INDEX IF NOT EXISTS idx_qf_host ON queue_fixes(host);
CREATE INDEX IF NOT EXISTS idx_qf_metadata ON queue_fixes USING GIN(metadata);
`;

async function main() {
  console.error('🚀 queue_fixes migration\n');

  const dbConfig = await getDatabaseConfigToml();
  if (dbConfig.type !== 'postgresql' || !dbConfig.postgresql) {
    console.error('❌ TOML config does not declare postgresql');
    process.exit(1);
  }

  const pgConfig = dbConfig.postgresql;
  const password = pgConfig.password ?? process.env.MCPMEM_PG_PASSWORD ?? '';

  const pool = new pg.Pool({
    host: pgConfig.hosts[0],
    port: pgConfig.port ?? 5432,
    database: pgConfig.database,
    user: pgConfig.user,
    password,
    ssl: pgConfig.sslmode === 'require' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    console.error(`📡 Connected to ${pgConfig.hosts[0]}:${pgConfig.port ?? 5432}/${pgConfig.database}`);

    // Pre-check: does the table already exist?
    const before = await client.query(
      `SELECT to_regclass('public.queue_fixes') AS exists`
    );
    const existedBefore = before.rows[0].exists !== null;
    console.error(`📋 queue_fixes existed before: ${existedBefore}`);

    console.error('⚡ Running migration...');
    await client.query(MIGRATION_SQL);

    // Post-check: verify table + indexes
    const tableCheck = await client.query(
      `SELECT to_regclass('public.queue_fixes') AS exists`
    );
    if (tableCheck.rows[0].exists === null) {
      throw new Error('queue_fixes table not found after migration');
    }

    const indexCheck = await client.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'queue_fixes'
       ORDER BY indexname`
    );
    const indexes = indexCheck.rows.map((r) => r.indexname);
    console.error(`✅ Indexes: ${indexes.join(', ')}`);

    // Smoke: count rows (will be 0 on a fresh migration)
    const count = await client.query(`SELECT COUNT(*)::int AS n FROM queue_fixes`);
    console.error(`✅ queue_fixes row count: ${count.rows[0].n}`);

    console.error('\n✅ Migration complete');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
