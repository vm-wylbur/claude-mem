// Author: PB and Claude
// Date: 2025-07-02
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// src/config-toml.ts

import * as toml from 'toml';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConfig, ConfigurationInfo } from './db/adapters/base.js';

interface TomlConfig {
  database: {
    type: 'sqlite' | 'postgresql';
    sqlite?: {
      path: string;
      backup_enabled?: boolean;
      backup_path?: string;
      max_backup_files?: number;
    };
    postgresql?: {
      hosts: string[];
      database: string;
      user: string;
      password?: string;
      port?: number;
      sslmode?: string;
      max_connections?: number;
      connection_timeout_ms?: number;
      // Removed: SSH tunnel fields no longer supported
    };
  };
  ollama?: {
    host: string;
    model: string;
    embedding_dimensions: number;
    timeout_ms?: number;
  };
  server?: {
    name: string;
    version: string;
  };
  logging?: {
    level: string;
    file?: string;
    max_file_size_mb?: number;
    max_files?: number;
  };
  features?: {
    vector_search?: boolean;
    metadata_indexing?: boolean;
    relationship_tracking?: boolean;
    auto_embedding?: boolean;
    debug_sql?: boolean;
    verbose_search?: boolean;
  };
}

/**
 * TOML Configuration Loader with Environment Variable Overrides
 * 
 * Priority order:
 * 1. Environment variables (highest priority)
 * 2. TOML config file
 * 3. Built-in defaults (lowest priority)
 * 
 * Config file locations (checked in order):
 * - ~/.config/claude-mem/claude-mem.toml
 * - ./claude-mem.toml (project root)
 */
export class TomlConfigLoader {
  private static instance: TomlConfigLoader;
  private config: TomlConfig | null = null;
  
  private constructor() {}
  
  static getInstance(): TomlConfigLoader {
    if (!TomlConfigLoader.instance) {
      TomlConfigLoader.instance = new TomlConfigLoader();
    }
    return TomlConfigLoader.instance;
  }
  
  /**
   * Load configuration from TOML file with environment variable overrides
   */
  async load(): Promise<DatabaseConfig> {
    // Try to load TOML config
    this.config = this.loadTomlConfig();
    
    // Apply environment variable overrides
    return this.buildDatabaseConfig();
  }
  
  private loadTomlConfig(): TomlConfig | null {
    const configPaths = [
      path.join(os.homedir(), '.config', 'claude-mem', 'claude-mem.toml'),
      path.join(process.cwd(), 'claude-mem.toml')
    ];
    
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const configContent = fs.readFileSync(configPath, 'utf8');
          const parsed = toml.parse(configContent) as TomlConfig;
          console.error(`📁 Loaded config from: ${configPath}`);
          return parsed;
        } catch (error) {
          console.error(`❌ Error parsing TOML config at ${configPath}:`, error);
          continue;
        }
      }
    }
    
    console.error('📝 No TOML config found, using environment variables and defaults');
    return null;
  }
  
  private buildDatabaseConfig(): DatabaseConfig {
    // Environment variables take precedence over TOML config
    const dbType = (process.env.MCPMEM_DB_TYPE || this.config?.database.type || 'sqlite') as 'sqlite' | 'postgresql';
    
    if (dbType === 'sqlite') {
      return {
        type: 'sqlite',
        sqlite: {
          path: process.env.MCPMEM_DB_PATH || 
                this.config?.database.sqlite?.path || 
                this.expandPath('~/.local/share/mcp-memory/memory.db')
        }
      };
    } else {
      // PostgreSQL configuration
      const hosts = process.env.MCPMEM_PG_HOSTS?.split(',') || 
                   this.config?.database.postgresql?.hosts || 
                   ['localhost']; // Default to localhost if not configured
                   
      // Removed: SSH tunnel environment variable fallbacks (MCPMEM_PG_TUNNEL, etc.)
                    
      return {
        type: 'postgresql',
        postgresql: {
          hosts,
          database: process.env.MCPMEM_PG_DATABASE || 
                   this.config?.database.postgresql?.database || 
                   'claude_mem',
          user: process.env.MCPMEM_PG_USER || 
               this.config?.database.postgresql?.user || 
               'pball',
          password: process.env.MCPMEM_PG_PASSWORD || 
                   this.config?.database.postgresql?.password,
          port: process.env.MCPMEM_PG_PORT ? 
               parseInt(process.env.MCPMEM_PG_PORT) : 
               this.config?.database.postgresql?.port,
          sslmode: process.env.MCPMEM_PG_SSLMODE || 
                  this.config?.database.postgresql?.sslmode,
          // Removed: tunnel property (SSH tunnel support removed)
          max_connections: this.config?.database.postgresql?.max_connections,
          connection_timeout_ms: this.config?.database.postgresql?.connection_timeout_ms
        }
      };
    }
  }
  
  /**
   * Expand tilde paths to full home directory paths
   */
  private expandPath(filepath: string): string {
    if (filepath.startsWith('~/')) {
      return path.join(os.homedir(), filepath.slice(2));
    }
    return filepath;
  }
  
  /**
   * Get configuration summary for debugging
   */
  getConfigSummary(): string {
    if (!this.config) {
      return 'Configuration: Environment variables only';
    }
    
    const summary = [
      `Database type: ${this.config.database.type}`,
      `Ollama host: ${this.config.ollama?.host || 'default'}`,
      `Server name: ${this.config.server?.name || 'default'}`,
      `Features enabled: ${Object.keys(this.config.features || {}).length}`
    ];
    
    return summary.join('\n');
  }
}

/**
 * Get database configuration using TOML config loader
 */
export async function getDatabaseConfigToml(): Promise<DatabaseConfig> {
  const loader = TomlConfigLoader.getInstance();
  return await loader.load();
}

/**
 * Get configuration summary for debugging
 */
export function getConfigSummaryToml(): string {
  const loader = TomlConfigLoader.getInstance();
  return loader.getConfigSummary();
}

/**
 * Get detailed configuration information for diagnostics
 */
export function getConfigurationInfo(): ConfigurationInfo {
  const loader = TomlConfigLoader.getInstance();
  
  // Determine config source
  let source: 'toml' | 'env' | 'default';
  let configPath: string | undefined;
  
  if ((loader as any).config) {
    source = 'toml';
    // Check the standard config paths
    const configPaths = [
      path.join(os.homedir(), '.config', 'claude-mem', 'claude-mem.toml'),
      path.join(process.cwd(), 'claude-mem.toml')
    ];
    
    for (const testPath of configPaths) {
      if (fs.existsSync(testPath)) {
        configPath = testPath;
        break;
      }
    }
  } else if (process.env.MCPMEM_DB_TYPE) {
    source = 'env';
  } else {
    source = 'default';
  }
  
  // Detect environment variable overrides
  const overrides: string[] = [];
  const envVars = [
    'MCPMEM_DB_TYPE',
    'MCPMEM_PG_HOSTS', 
    'MCPMEM_PG_DATABASE',
    'MCPMEM_PG_USER',
    'MCPMEM_PG_PASSWORD',
    'MCPMEM_PG_PORT',
    'MCPMEM_PG_SSLMODE'
  ];
  
  for (const envVar of envVars) {
    if (process.env[envVar]) {
      overrides.push(envVar);
    }
  }
  
  return {
    source,
    configPath,
    overrides
  };
}