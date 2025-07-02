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
 *   MCPMEM_PG_HOSTS=snowl,snowball
 *   MCPMEM_PG_DATABASE=claude_mem
 *   MCPMEM_PG_USER=pball
 *   MCPMEM_PG_TUNNEL=true
 *   MCPMEM_PG_TUNNEL_PORT=5433
 */

import { config } from 'dotenv';
import { getDatabaseConfig } from '../src/config.js';
import { initializePostgresDatabase } from '../src/db/postgres-init.js';

// Load environment variables
config();

async function main() {
  try {
    console.error('🚀 PostgreSQL Database Initialization');
    console.error('=====================================\n');
    
    // Get PostgreSQL configuration
    const dbConfig = getDatabaseConfig();
    
    if (dbConfig.type !== 'postgresql') {
      console.error('❌ Set MCPMEM_DB_TYPE=postgresql to use this script');
      console.error('   Example: MCPMEM_DB_TYPE=postgresql npm run init:postgres');
      process.exit(1);
    }
    
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
    console.error('\nTo use PostgreSQL, set these environment variables:');
    console.error('  MCPMEM_DB_TYPE=postgresql');
    console.error(`  MCPMEM_PG_DATABASE=${pgConfig.database}`);
    console.error(`  MCPMEM_PG_USER=${pgConfig.user}`);
    console.error(`  MCPMEM_PG_HOSTS=${pgConfig.hosts.join(',')}`);
    console.error(`  MCPMEM_PG_TUNNEL=${pgConfig.tunnel}`);
    if (pgConfig.tunnel) {
      console.error(`  MCPMEM_PG_TUNNEL_PORT=${pgConfig.tunnelPort}`);
    }
    
  } catch (error) {
    console.error('\n❌ Initialization failed:');
    console.error(error);
    process.exit(1);
  }
}

main();