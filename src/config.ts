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
 * DEPRECATED: Use TOML configuration instead of environment variables.
 * This function is kept for backward compatibility only.
 * Use getDatabaseConfigToml() for new code.
 */

export function getDatabaseConfig(): DatabaseConfig {
  console.warn('⚠️  getDatabaseConfig() is deprecated. Use getDatabaseConfigToml() instead.');
  
  // Fallback to sqlite for legacy compatibility
  return {
    type: 'sqlite',
    sqlite: {
      path: path.join(process.cwd(), 'memory.db')
    }
  };
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
      return `PostgreSQL: ${pg.database}@${pg.hosts[0]}:${pg.port || 5432}`;
      
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