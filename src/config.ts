// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/config.ts

import { DatabaseConfig } from './db/adapters/base.js';
import path from 'path';
import { getDatabaseConfigToml, getConfigSummaryToml } from './config-toml.js';

/**
 * Database Configuration Management
 * 
 * Provides centralized configuration for database selection and connection settings.
 * Supports both SQLite and PostgreSQL backends with environment variable overrides.
 * 
 * Environment Variables:
 * - MCPMEM_DB_TYPE: 'sqlite' | 'postgresql' (default: 'sqlite')
 * - MCPMEM_DB_PATH: SQLite database file path
 * - MCPMEM_PG_HOSTS: Comma-separated PostgreSQL hosts (for SSH tunnel failover)
 * - MCPMEM_PG_DATABASE: PostgreSQL database name
 * - MCPMEM_PG_USER: PostgreSQL username
 * - MCPMEM_PG_TUNNEL: Enable SSH tunneling ('true'|'false')
 * - MCPMEM_PG_TUNNEL_PORT: Local port for SSH tunnel
 */

export function getDatabaseConfig(): DatabaseConfig {
  const dbType = (process.env.MCPMEM_DB_TYPE || 'sqlite') as 'sqlite' | 'postgresql';
  
  switch (dbType) {
    case 'sqlite':
      return {
        type: 'sqlite',
        sqlite: {
          path: process.env.MCPMEM_DB_PATH || path.join(process.cwd(), 'memory.db')
        }
      };
      
    case 'postgresql':
      const pgHosts = process.env.MCPMEM_PG_HOSTS?.split(',') || ['snowl', 'snowball'];
      const pgTunnel = process.env.MCPMEM_PG_TUNNEL?.toLowerCase() === 'true';
      
      return {
        type: 'postgresql',
        postgresql: {
          hosts: pgHosts,
          database: process.env.MCPMEM_PG_DATABASE || 'claude_mem',
          user: process.env.MCPMEM_PG_USER || 'pball',
          tunnel: pgTunnel,
          tunnelPort: process.env.MCPMEM_PG_TUNNEL_PORT ? parseInt(process.env.MCPMEM_PG_TUNNEL_PORT) : 5433
        }
      };
      
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Create database adapter factory based on configuration
 */
export async function createDatabaseAdapter() {
  const config = getDatabaseConfig();
  
  switch (config.type) {
    case 'sqlite': {
      const { SqliteAdapter } = await import('./db/adapters/sqlite.js');
      const { initializeDatabase } = await import('./db/init.js');
      
      // Ensure SQLite database schema exists
      await initializeDatabase(config.sqlite!.path);
      
      const adapter = new SqliteAdapter(config);
      await adapter.connect();
      return adapter;
    }
    
    case 'postgresql': {
      const { PostgresAdapter } = await import('./db/adapters/postgres.js');
      
      const adapter = new PostgresAdapter(config);
      await adapter.connect();
      return adapter;
    }
    
    default:
      throw new Error(`Unsupported database type: ${config.type}`);
  }
}

/**
 * Get configuration summary for logging
 */
export function getConfigSummary(): string {
  const config = getDatabaseConfig();
  
  switch (config.type) {
    case 'sqlite':
      return `SQLite: ${config.sqlite!.path}`;
      
    case 'postgresql':
      const pg = config.postgresql!;
      const tunnelInfo = pg.tunnel ? ` via SSH tunnel (${pg.hosts.join(', ')})` : '';
      return `PostgreSQL: ${pg.database}@${pg.hosts[0]}${tunnelInfo}`;
      
    default:
      return 'Unknown database type';
  }
}

/**
 * Enhanced database adapter factory using TOML configuration
 */
export async function createDatabaseAdapterToml() {
  const config = await getDatabaseConfigToml();
  
  switch (config.type) {
    case 'sqlite': {
      const { SqliteAdapter } = await import('./db/adapters/sqlite.js');
      const { initializeDatabase } = await import('./db/init.js');
      
      // Ensure SQLite database schema exists
      await initializeDatabase(config.sqlite!.path);
      
      const adapter = new SqliteAdapter(config);
      await adapter.connect();
      return adapter;
    }
    
    case 'postgresql': {
      const { PostgresAdapter } = await import('./db/adapters/postgres.js');
      
      const adapter = new PostgresAdapter(config);
      await adapter.connect();
      return adapter;
    }
    
    default:
      throw new Error(`Unsupported database type: ${config.type}`);
  }
}