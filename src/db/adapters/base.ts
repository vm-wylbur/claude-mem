// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// mcp-long-term-memory-pg/src/db/adapters/base.ts

import { MemoryType, MemoryMetadata, Memory } from '../service.js';

/**
 * Database Adapter Interface for Memory Management System
 * 
 * Provides database abstraction layer supporting SQLite and PostgreSQL backends.
 * Uses Repository + Adapter patterns for clean separation of database concerns.
 * 
 * @references
 * - Repository Pattern: https://dev.to/fyapy/repository-pattern-with-typescript-and-nodejs-25da
 * - Database Abstraction: https://markus.oberlehner.net/blog/building-a-simple-database-abstraction-with-typescript
 * - Adapter Pattern: https://refactoring.guru/design-patterns/adapter/typescript/example
 * - TypeORM Multi-DB: https://github.com/typeorm/typeorm
 * - Reader/Writer Interface Pattern: https://dev.to/fyapy/fully-featured-repository-pattern-with-typescript-and-native-postgresql-driver-4f2j
 * 
 * @design_decisions
 * - Domain-specific interface (memory operations) vs generic CRUD
 * - Async/await throughout for consistency  
 * - Type-safe operations with TypeScript generics
 * - Connection lifecycle management built-in
 * - Memory-specific features (similarity search, tags, metadata)
 * 
 * @author PB and Claude
 * @date 2025-07-01
 * @license (c) HRDAG, 2025, GPL-2 or newer
 */
export interface DatabaseAdapter {
  //
  // Connection Lifecycle Management
  //
  
  /**
   * Establish connection to the database
   * Handles connection pooling, SSH tunnels, etc. as needed
   */
  connect(): Promise<void>;
  
  /**
   * Close database connection and cleanup resources
   */
  disconnect(): Promise<void>;
  
  /**
   * Check if database connection is healthy
   * @returns Promise resolving to true if connection is working
   */
  healthCheck(): Promise<boolean>;

  //
  // Core Memory Operations
  //

  /**
   * Store a new memory with optional embedding generation
   * @param content - The text content of the memory
   * @param type - Type of memory (conversation, code, decision, reference)
   * @param metadata - Structured metadata for the memory
   * @param projectId - Project this memory belongs to
   * @returns Promise resolving to the new memory hash ID (as string)
   */
  storeMemory(
    content: string, 
    type: MemoryType, 
    metadata: MemoryMetadata, 
    projectId: number
  ): Promise<string>;

  /**
   * Retrieve a specific memory by ID
   * @param memoryId - Hash identifier for the memory (BIGINT as string)
   * @returns Promise resolving to Memory object or null if not found
   */
  getMemory(memoryId: string): Promise<Memory | null>;

  /**
   * Get all memories for a specific project
   * @param projectId - Project identifier
   * @param limit - Optional limit on number of results
   * @returns Promise resolving to array of Memory objects
   */
  getProjectMemories(projectId: number, limit?: number): Promise<Memory[]>;

  //
  // Search Operations
  //

  /**
   * Find memories similar to given content using semantic search
   * SQLite: Uses in-memory cosine similarity calculation
   * PostgreSQL: Uses pgvector native similarity operations
   * 
   * @param content - Text to find similar memories for
   * @param limit - Maximum number of results to return
   * @param projectId - Optional project filter
   * @returns Promise resolving to array of Memory objects with similarity scores
   */
  findSimilarMemories(
    content: string, 
    limit: number, 
    projectId?: number
  ): Promise<Memory[]>;

  /**
   * Search memories by metadata properties
   * Uses database-specific JSON/JSONB query capabilities
   * 
   * @param query - Metadata query object
   * @param projectId - Optional project filter
   * @returns Promise resolving to array of matching memories
   */
  searchByMetadata(
    query: Record<string, any>, 
    projectId?: number
  ): Promise<Memory[]>;

  //
  // Project Management
  //

  /**
   * Create a new project
   * @param name - Project name (must be unique)
   * @param description - Optional project description
   * @returns Promise resolving to new project ID
   */
  createProject(name: string, description?: string): Promise<number>;

  /**
   * Get project by name
   * @param name - Project name to look up
   * @returns Promise resolving to project info or null if not found
   */
  getProject(name: string): Promise<{project_id: number; name: string; description?: string} | null>;

  //
  // Tag Management  
  //

  /**
   * Add tags to a memory
   * Creates tags if they don't exist, links them to the memory
   * 
   * @param memoryId - Memory hash ID to tag (BIGINT as string)
   * @param tags - Array of tag strings
   */
  addMemoryTags(memoryId: string, tags: string[]): Promise<void>;

  /**
   * Get all tags for a memory
   * @param memoryId - Memory hash ID to get tags for (BIGINT as string)
   * @returns Promise resolving to array of tag strings
   */
  getMemoryTags(memoryId: string): Promise<string[]>;

  /**
   * Get all available tags in the system
   * @param projectId - Optional project filter
   * @returns Promise resolving to array of tag strings
   */
  getAllTags(projectId?: number): Promise<string[]>;

  /**
   * Get memories that have a specific tag
   * @param tagName - Name of the tag to filter by
   * @param projectId - Optional project filter
   * @param limit - Optional limit on number of results
   * @returns Promise resolving to array of Memory objects
   */
  getMemoriesByTag(tagName: string, projectId?: number, limit?: number): Promise<Memory[]>;

  //
  // Relationship Management
  //

  /**
   * Create relationship between two memories
   * @param sourceMemoryId - Source memory hash ID (BIGINT as string)
   * @param targetMemoryId - Target memory hash ID (BIGINT as string)
   * @param relationshipType - Type of relationship (e.g., 'references', 'builds_on')
   */
  createMemoryRelationship(
    sourceMemoryId: string, 
    targetMemoryId: string, 
    relationshipType: string
  ): Promise<void>;
}

/**
 * Database connection configuration interface
 * Supports both SQLite and PostgreSQL configuration options
 */
export interface DatabaseConfig {
  type: 'sqlite' | 'postgresql';
  
  sqlite?: {
    path: string;
  };
  
  postgresql?: {
    hosts: string[];        // SSH tunnel targets ['snowl', 'snowball']
    database: string;
    user: string;
    tunnel: boolean;
    tunnelPort?: number;
  };
}

/**
 * Database adapter creation errors
 */
export class DatabaseAdapterError extends Error {
  constructor(message: string, public readonly adapterType: string) {
    super(`[${adapterType}] ${message}`);
    this.name = 'DatabaseAdapterError';
  }
}

/**
 * Connection-related errors
 */
export class DatabaseConnectionError extends DatabaseAdapterError {
  constructor(message: string, adapterType: string) {
    super(`Connection failed: ${message}`, adapterType);
    this.name = 'DatabaseConnectionError';
  }
}