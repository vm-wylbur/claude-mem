#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2025-07-03
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// scripts/test-hash-utils.ts

/**
 * Hash Utility Unit Tests
 * 
 * Tests the hash utility functions without requiring database connections.
 * These are pure unit tests that validate hash generation and formatting.
 */

import { 
  generateMemoryHash, 
  generateTagHash,
  formatHashForDisplay, 
  parseHexToHash,
  isValidHashId,
  isValidTagName,
  initializeHasher 
} from '../src/utils/hash.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class HashUtilityTester {
  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.error('🧪 Hash Utility Unit Tests');
    console.error('============================\n');

    // Initialize hasher first
    await initializeHasher();
    console.error('✅ Hash utility initialized\n');

    // Run all tests
    this.testMemoryHashGeneration();
    this.testTagHashGeneration();
    this.testHashFormatting();
    this.testHashValidation();
    this.testTagNameValidation();
    this.testHashConsistency();

    this.printResults();
  }

  private testMemoryHashGeneration(): void {
    try {
      const content = "Test memory content";
      const type = "code";
      
      const hash1 = generateMemoryHash(content, type);
      const hash2 = generateMemoryHash(content, type);
      
      // Should be deterministic (same input = same hash)
      if (hash1 !== hash2) {
        throw new Error(`Hash generation not deterministic: ${hash1} !== ${hash2}`);
      }
      
      // Should be hex string
      if (!/^[0-9a-f]+$/i.test(hash1)) {
        throw new Error(`Hash not in hex format: ${hash1}`);
      }
      
      // Different content should produce different hashes
      const differentHash = generateMemoryHash("Different content", type);
      if (hash1 === differentHash) {
        throw new Error('Different content produced same hash');
      }
      
      // Different type should produce different hashes
      const differentTypeHash = generateMemoryHash(content, "conversation");
      if (hash1 === differentTypeHash) {
        throw new Error('Different type produced same hash');
      }
      
      this.results.push({ name: 'Memory Hash Generation', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Memory Hash Generation', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testTagHashGeneration(): void {
    try {
      const tagName = "testtag";
      
      const hash1 = generateTagHash(tagName);
      const hash2 = generateTagHash(tagName);
      
      // Should be deterministic
      if (hash1 !== hash2) {
        throw new Error(`Tag hash generation not deterministic: ${hash1} !== ${hash2}`);
      }
      
      // Should be hex string
      if (!/^[0-9a-f]+$/i.test(hash1)) {
        throw new Error(`Tag hash not in hex format: ${hash1}`);
      }
      
      // Case insensitive - lowercase and uppercase should produce same hash
      const upperHash = generateTagHash("TESTTAG");
      if (hash1 !== upperHash) {
        throw new Error('Tag hash not case-insensitive');
      }
      
      this.results.push({ name: 'Tag Hash Generation', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Tag Hash Generation', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testHashFormatting(): void {
    try {
      const hexHash = "abc123def456";
      
      // Test normal formatting
      const formatted = formatHashForDisplay(hexHash);
      if (!/^[0-9a-f]{16}$/i.test(formatted)) {
        throw new Error(`Formatted hash wrong format: ${formatted}`);
      }
      
      // Test padding
      const shortHash = "abc";
      const paddedFormatted = formatHashForDisplay(shortHash);
      if (paddedFormatted.length !== 16) {
        throw new Error(`Hash not padded to 16 chars: ${paddedFormatted}`);
      }
      
      // Test null/undefined handling
      const nullFormatted = formatHashForDisplay(null);
      if (nullFormatted !== '0000000000000000') {
        throw new Error(`Null hash not handled correctly: ${nullFormatted}`);
      }
      
      this.results.push({ name: 'Hash Formatting', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Hash Formatting', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testHashValidation(): void {
    try {
      // Test valid hash IDs
      const validHashes = ['123456789', 'abc123def456', '0'];
      for (const hash of validHashes) {
        if (!isValidHashId(hash)) {
          throw new Error(`Valid hash rejected: ${hash}`);
        }
      }
      
      // Test invalid hash IDs
      const invalidHashes = ['not-a-number', '', 'abc-xyz'];
      for (const hash of invalidHashes) {
        if (isValidHashId(hash)) {
          throw new Error(`Invalid hash accepted: ${hash}`);
        }
      }
      
      this.results.push({ name: 'Hash Validation', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Hash Validation', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testTagNameValidation(): void {
    try {
      // Test valid tag names
      const validTags = ['tag', 'testtag', 'my_tag', 'tag123'];
      for (const tag of validTags) {
        if (!isValidTagName(tag)) {
          throw new Error(`Valid tag rejected: ${tag}`);
        }
      }
      
      // Test invalid tag names
      const invalidTags = ['', '   ', 'tag\n', 'x'.repeat(101)];
      for (const tag of invalidTags) {
        if (isValidTagName(tag)) {
          throw new Error(`Invalid tag accepted: ${tag}`);
        }
      }
      
      this.results.push({ name: 'Tag Name Validation', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Tag Name Validation', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private testHashConsistency(): void {
    try {
      // Test parse/format round trip
      const originalHex = "abc123def456";
      const parsed = parseHexToHash(originalHex);
      const formatted = formatHashForDisplay(parsed);
      
      if (!formatted.includes(originalHex.toLowerCase())) {
        throw new Error(`Round trip failed: ${originalHex} -> ${parsed} -> ${formatted}`);
      }
      
      // Test with 0x prefix
      const withPrefix = "0xabc123";
      const parsedPrefix = parseHexToHash(withPrefix);
      if (parsedPrefix !== "abc123") {
        throw new Error(`0x prefix not handled: ${withPrefix} -> ${parsedPrefix}`);
      }
      
      this.results.push({ name: 'Hash Consistency', passed: true });
    } catch (error) {
      this.results.push({ 
        name: 'Hash Consistency', 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private printResults(): void {
    console.error('\n📊 Test Results:');
    console.error('================');
    
    let passed = 0;
    let total = this.results.length;
    
    for (const result of this.results) {
      const status = result.passed ? '✅' : '❌';
      console.error(`${status} ${result.name}`);
      if (!result.passed && result.error) {
        console.error(`   Error: ${result.error}`);
      }
      if (result.passed) passed++;
    }
    
    console.error(`\n📈 Summary: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.error('🎉 All hash utility tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some hash utility tests failed');
      process.exit(1);
    }
  }
}

async function main() {
  const tester = new HashUtilityTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Hash utility tests failed:', error);
  process.exit(1);
});