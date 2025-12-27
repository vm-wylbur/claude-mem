// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// claude-mem/src/config.ts

import { DatabaseConfig } from './db/adapters/base.js';
import { getDatabaseConfigToml, getConfigSummaryToml } from './config-toml.js';

/**
 * Database Configuration Management
 *
 * DEPRECATED: Use TOML configuration instead of environment variables.
 * This function is kept for backward compatibility only.
 * Use getDatabaseConfigToml() for new code.
 */

export function getDatabaseConfig(): DatabaseConfig {
  console.warn('getDatabaseConfig() is deprecated. Use getDatabaseConfigToml() instead.');
  throw new Error('Legacy getDatabaseConfig() no longer supported. Use TOML configuration.');
}

/**
 * Create database adapter factory based on configuration
 */
export async function createDatabaseAdapter() {
  const config = await getDatabaseConfigToml();

  const { PostgresAdapter } = await import('./db/adapters/postgres.js');

  const adapter = new PostgresAdapter(config);
  await adapter.connect();
  return adapter;
}

/**
 * Get configuration summary for logging
 */
export function getConfigSummary(): string {
  return getConfigSummaryToml();
}

/**
 * Enhanced database adapter factory using TOML configuration
 */
export async function createDatabaseAdapterToml() {
  const config = await getDatabaseConfigToml();

  const { PostgresAdapter } = await import('./db/adapters/postgres.js');

  const adapter = new PostgresAdapter(config);
  await adapter.connect();
  return adapter;
}
