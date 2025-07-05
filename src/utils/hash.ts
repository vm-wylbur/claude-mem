// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// Hash utilities for memory ID generation using xxHash64

import xxhash from 'xxhash-wasm';

/**
 * xxHash64-based memory ID utilities
 * 
 * Uses xxHash64 for blazing-fast, collision-resistant hash generation
 * Stores as hex strings directly for simplicity and to avoid BigInt overflow
 * Human-readable hex format eliminates conversion overhead
 */

let hasher: any = null;

/**
 * Initialize the xxHash64 hasher (call once at startup)
 */
export async function initializeHasher(): Promise<void> {
  if (!hasher) {
    // xxhash-wasm needs to be initialized
    const xxhashModule = await xxhash();
    hasher = xxhashModule.h64;
  }
}

/**
 * Generate a deterministic hash ID for memory content
 * 
 * @param content - The memory content text
 * @param contentType - The type of memory (conversation, code, decision, reference)
 * @returns Hex hash string (for database storage)
 */
export function generateMemoryHash(content: string, contentType: string): string {
  if (!hasher) {
    throw new Error('Hash utility not initialized. Call initializeHasher() first.');
  }
  
  // Combine content and type for hash input
  // This ensures same content with different types gets different IDs
  const hashInput = `${content}:${contentType}`;
  
  // Generate xxHash64 and convert to hex string for consistency
  const hashBigInt = hasher(hashInput);
  const hashHex = hashBigInt.toString(16);
  
  return hashHex;
}

/**
 * Format a BIGINT hash ID as hex string for display
 * 
 * @param hashId - Hex hash string  
 * @returns 16-character padded hex string
 */
export function formatHashForDisplay(hashId: string | null | undefined): string {
  if (hashId === null || hashId === undefined) {
    return '0000000000000000';
  }
  
  // SIMPLE: Always treat as hex, pad to 16 chars, done.
  return hashId.toLowerCase().padStart(16, '0');
}

/**
 * Parse a hex-formatted hash (now this is just cleanup/validation)
 * 
 * @param hexHash - Hex string (e.g., "a1b2c3d4e5f67890")
 * @returns Clean hex string for database operations
 */
export function parseHexToHash(hexHash: string): string {
  // Remove any 0x prefix if present and return clean hex
  return hexHash.replace(/^0x/, '').toLowerCase();
}

/**
 * Validate that a hash ID is properly formatted
 * 
 * @param hashId - Hash ID to validate
 * @returns true if valid hex hash
 */
export function isValidHashId(hashId: string): boolean {
  if (!hashId || typeof hashId !== 'string') return false;
  
  // SIMPLE: Must be valid hex characters, any reasonable length
  return /^[0-9a-f]+$/i.test(hashId);
}

/**
 * Generate a deterministic hash ID for tag names
 * 
 * @param tagName - The tag name text
 * @returns Hex hash string (for database storage)
 */
export function generateTagHash(tagName: string): string {
  if (!hasher) {
    throw new Error('Hash utility not initialized. Call initializeHasher() first.');
  }
  
  const validation = validateTagName(tagName);
  if (!validation.valid) {
    throw new Error(`Invalid tag name "${tagName}": ${validation.error}`);
  }
  
  // Normalize tag name for consistent hashing
  const normalizedName = tagName.toLowerCase().trim();
  const hashInput = `tag:${normalizedName}`;
  
  // Generate xxHash64 and convert to hex string for consistency with memory hashes
  const hashBigInt = hasher(hashInput);
  const hashHex = hashBigInt.toString(16);
  
  return hashHex;
}

/**
 * Validate tag name and return detailed error information
 * 
 * @param tagName - Tag name to validate
 * @returns Object with validation result and specific error message
 */
export function validateTagName(tagName: any): { valid: boolean; error: string | null } {
  // Check type first
  if (typeof tagName !== 'string') {
    return { valid: false, error: 'Tag name must be a string' };
  }
  
  const trimmed = tagName.trim();
  
  // Check for empty or whitespace-only
  if (trimmed.length === 0) {
    return { valid: false, error: tagName === '' ? 'Tag name cannot be empty' : 'Tag name cannot be empty or contain only whitespace' };
  }
  
  // Check length
  if (trimmed.length > 100) {
    return { valid: false, error: 'Tag name cannot exceed 100 characters' };
  }
  
  // Check for control characters first (includes newlines, tabs, etc.)
  if (/[\x00-\x1f\x7f-\x9f]/.test(tagName)) {
    return { valid: false, error: 'Tag name cannot contain control characters' };
  }
  
  // Check for leading/trailing whitespace
  if (trimmed !== tagName) {
    return { valid: false, error: 'Tag name cannot have leading or trailing whitespace' };
  }
  
  // Check for invalid hyphen patterns (start/end with hyphen, consecutive hyphens)
  if (trimmed.startsWith('-') || trimmed.endsWith('-')) {
    return { valid: false, error: 'Tag name cannot start or end with hyphens' };
  }
  
  if (trimmed.includes('--')) {
    return { valid: false, error: 'Tag name cannot contain consecutive hyphens' };
  }
  
  // All checks passed
  return { valid: true, error: null };
}

/**
 * Validate that a tag name is properly formatted (legacy function)
 * 
 * @param tagName - Tag name to validate
 * @returns true if valid tag name
 * @deprecated Use validateTagName() for better error messages
 */
export function isValidTagName(tagName: string): boolean {
  const result = validateTagName(tagName);
  return result.valid;
}

/**
 * Generate hash for existing data migration
 * Use this to generate consistent hashes for data that already exists
 * 
 * @param content - Memory content
 * @param contentType - Memory type
 * @param createdAt - Optional timestamp for uniqueness (if content might not be unique)
 * @returns BIGINT hash as string
 */
export function generateMigrationHash(
  content: string, 
  contentType: string, 
  createdAt?: string
): string {
  if (!hasher) {
    throw new Error('Hash utility not initialized. Call initializeHasher() first.');
  }
  
  // For migration, we might need timestamp to ensure uniqueness
  // if there could be duplicate content
  let hashInput = `${content}:${contentType}`;
  if (createdAt) {
    hashInput += `:${createdAt}`;
  }
  
  const hashBigInt = hasher(hashInput);
  
  return hashBigInt.toString(16);
}

/**
 * Generate hash for tag migration
 * Use this to generate consistent hashes for existing tag data
 * 
 * @param tagName - Tag name from existing data
 * @param tagId - Optional original tag ID for collision detection
 * @returns BIGINT hash as string
 */
export function generateTagMigrationHash(tagName: string, tagId?: number): string {
  if (!hasher) {
    throw new Error('Hash utility not initialized. Call initializeHasher() first.');
  }
  
  // Normalize the tag name the same way as generateTagHash
  const normalizedName = tagName.toLowerCase().trim();
  
  // Use the same input format as generateTagHash for consistency
  let hashInput = `tag:${normalizedName}`;
  
  // If we have collision concerns, we can include the original ID
  if (tagId !== undefined) {
    // This is a fallback for the extremely unlikely case of hash collision
    hashInput += `:fallback:${tagId}`;
  }
  
  const hashBigInt = hasher(hashInput);
  
  return hashBigInt.toString(16);
}