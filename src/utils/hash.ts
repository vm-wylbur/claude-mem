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
 * Stores as BIGINT (8 bytes) for maximum database performance
 * Displays as hex strings for human readability
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
  
  // Generate xxHash64 and return hex directly (no BigInt conversion needed)
  const hashHex = hasher(hashInput);
  
  return hashHex;
}

/**
 * Format a BIGINT hash ID as hex string for display
 * 
 * @param hashId - BIGINT hash ID as string
 * @returns Hex-formatted string (e.g., "a1b2c3d4e5f67890")
 */
export function formatHashForDisplay(hashId: string | bigint | null | undefined): string {
  if (hashId === null || hashId === undefined) {
    console.error('formatHashForDisplay received null/undefined hashId:', hashId);
    return '0000000000000000'; // Return a default hex value
  }
  
  try {
    const bigintValue = typeof hashId === 'string' ? BigInt(hashId) : hashId;
    return bigintValue.toString(16).padStart(16, '0');
  } catch (error) {
    console.error('Error formatting hash for display:', error, 'hashId:', hashId);
    return '0000000000000000'; // Return a default hex value
  }
}

/**
 * Parse a hex-formatted hash back to BIGINT string
 * 
 * @param hexHash - Hex string (e.g., "a1b2c3d4e5f67890")
 * @returns BIGINT hash as string for database operations
 */
export function parseHexToHash(hexHash: string): string {
  // Remove any 0x prefix if present
  const cleanHex = hexHash.replace(/^0x/, '');
  const bigintValue = BigInt('0x' + cleanHex);
  return bigintValue.toString();
}

/**
 * Validate that a hash ID is properly formatted
 * 
 * @param hashId - Hash ID to validate
 * @returns true if valid BIGINT hash
 */
export function isValidHashId(hashId: string): boolean {
  try {
    const bigintValue = BigInt(hashId);
    // Ensure it's a positive 64-bit integer
    return bigintValue >= 0n && bigintValue <= 0xffffffffffffffffn;
  } catch {
    return false;
  }
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
  
  if (!isValidTagName(tagName)) {
    throw new Error(`Invalid tag name: ${tagName}`);
  }
  
  // Normalize tag name for consistent hashing
  const normalizedName = tagName.toLowerCase().trim();
  const hashInput = `tag:${normalizedName}`;
  
  // Generate xxHash64 and return hex directly (no BigInt conversion needed)
  const hashHex = hasher(hashInput);
  
  return hashHex;
}

/**
 * Validate that a tag name is properly formatted
 * 
 * @param tagName - Tag name to validate
 * @returns true if valid tag name
 */
export function isValidTagName(tagName: string): boolean {
  if (typeof tagName !== 'string') return false;
  
  const trimmed = tagName.trim();
  
  // Must be non-empty and reasonable length
  if (trimmed.length === 0 || trimmed.length > 100) return false;
  
  // No leading/trailing whitespace after trim
  if (trimmed !== tagName) return false;
  
  // No control characters or problematic characters
  if (/[\x00-\x1f\x7f-\x9f]/.test(trimmed)) return false;
  
  return true;
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
  
  const hashHex = hasher(hashInput);
  const hashBigInt = BigInt('0x' + hashHex);
  
  return hashBigInt.toString();
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
  
  const hashHex = hasher(hashInput);
  const hashBigInt = BigInt('0x' + hashHex);
  
  return hashBigInt.toString();
}