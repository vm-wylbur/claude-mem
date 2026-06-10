#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// scripts/init-postgres.ts

/**
 * PostgreSQL Database Initialization Script
 * 
 * This script initializes a PostgreSQL database for the memory MCP server.
 * It can be run with different configuration options and handles SSH tunnels.
 * 
 * Usage:
 *   npm run init:postgres
 *   
 * Environment Variables:
 *   CLAUDE_MEM_PG_HOSTS=snowl,snowball
 *   CLAUDE_MEM_PG_DATABASE=claude_mem
 *   CLAUDE_MEM_PG_USER=pball
 */

import { config } from 'dotenv';
import { getDatabaseConfigToml } from '../src/config-toml.js';
import { initializePostgresDatabase } from '../src/db/postgres-init.js';

// Load environment variables
config();

async function main() {
  try {
    console.error('🚀 PostgreSQL Database Initialization');
    console.error('=====================================\n');
    
    // Get PostgreSQL configuration (TOML file + CLAUDE_MEM_PG_* env overrides).
    // The legacy getDatabaseConfig() was retired (throws) -- use the TOML loader.
    // (No DB_TYPE gate: the TOML loader's type is hardcoded 'postgresql';
    // the old MCPMEM_DB_TYPE check could never fail and the var read nothing.)
    const dbConfig = await getDatabaseConfigToml();

    const pgConfig = dbConfig.postgresql!;
    console.error('Configuration:');
    console.error(`  Database: ${pgConfig.database}`);
    console.error(`  User: ${pgConfig.user}`);
    console.error(`  Hosts: ${pgConfig.hosts.join(', ')}`);
    console.error(`  SSH Tunnel: ${pgConfig.tunnel ? 'Yes' : 'No'}`);
    if (pgConfig.tunnel) {
      console.error(`  Tunnel Port: ${pgConfig.tunnelPort}`);
    }
    console.error('');
    
    // Initialize database
    await initializePostgresDatabase(dbConfig);
    
    console.error('\n✅ PostgreSQL initialization complete!');
    console.error('\nTo use PostgreSQL, set these environment variables (or the TOML file):');
    console.error(`  CLAUDE_MEM_PG_DATABASE=${pgConfig.database}`);
    console.error(`  CLAUDE_MEM_PG_USER=${pgConfig.user}`);
    console.error(`  CLAUDE_MEM_PG_HOSTS=${pgConfig.hosts.join(',')}`);
    
  } catch (error) {
    console.error('\n❌ Initialization failed:');
    console.error(error);
    process.exit(1);
  }
}

main();