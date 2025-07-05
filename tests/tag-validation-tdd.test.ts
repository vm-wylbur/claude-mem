// TDD RED Phase: Better Tag Validation Error Messages  
// Author: PB and Claude
// Date: 2025-07-05
//
// Tests for Issues #1 and #2:
// #1: Better error messages for duplicate constraints and invalid names
// #2: Support for hyphenated tag names

import { describe, it, expect } from '@jest/globals';

// Import what we're testing
import { isValidTagName, generateTagHash } from '../src/utils/hash.js';

describe('Tag Validation Error Messages - RED Phase', () => {
  describe('Descriptive Error Messages', () => {
    it('should provide specific error message for empty tag names', () => {
      expect(() => isValidTagName('')).toThrow('Tag name cannot be empty');
    });

    it('should provide specific error message for whitespace-only tags', () => {
      expect(() => isValidTagName('   ')).toThrow('Tag name cannot be empty or contain only whitespace');
    });

    it('should provide specific error message for tags that are too long', () => {
      const longTag = 'x'.repeat(101);
      expect(() => isValidTagName(longTag)).toThrow('Tag name cannot exceed 100 characters');
    });

    it('should provide specific error message for tags with leading/trailing whitespace', () => {
      expect(() => isValidTagName(' tag ')).toThrow('Tag name cannot have leading or trailing whitespace');
    });

    it('should provide specific error message for tags with control characters', () => {
      expect(() => isValidTagName('tag\n')).toThrow('Tag name cannot contain control characters');
    });

    it('should provide specific error message for non-string input', () => {
      expect(() => isValidTagName(123 as any)).toThrow('Tag name must be a string');
    });
  });

  describe('Hyphenated Tag Support', () => {
    it('should accept hyphenated tags like startup-protocol', () => {
      expect(() => isValidTagName('startup-protocol')).not.toThrow();
    });

    it('should accept hyphenated tags like claude-mem', () => {
      expect(() => isValidTagName('claude-mem')).not.toThrow();
    });

    it('should accept complex hyphenated tags like test-driven-development', () => {
      expect(() => isValidTagName('test-driven-development')).not.toThrow();
    });

    it('should accept tags with single hyphens in middle', () => {
      expect(() => isValidTagName('api-testing')).not.toThrow();
    });

    it('should reject tags starting with hyphen', () => {
      expect(() => isValidTagName('-invalid')).toThrow('Tag name cannot start or end with hyphens');
    });

    it('should reject tags ending with hyphen', () => {
      expect(() => isValidTagName('invalid-')).toThrow('Tag name cannot start or end with hyphens');
    });

    it('should reject tags with multiple consecutive hyphens', () => {
      expect(() => isValidTagName('invalid--tag')).toThrow('Tag name cannot contain consecutive hyphens');
    });
  });

  describe('Enhanced Tag Validation Function', () => {
    it('should return detailed validation result with error message', () => {
      // This tests a new function that will replace isValidTagName for better error reporting
      const validateTagName = (tagName: string) => {
        try {
          isValidTagName(tagName);
          return { valid: true, error: null };
        } catch (error) {
          return { valid: false, error: error instanceof Error ? error.message : String(error) };
        }
      };

      const result = validateTagName('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Tag name cannot be empty');
    });
  });

  describe('Hash Generation with Hyphenated Tags', () => {
    it('should generate consistent hashes for hyphenated tags', () => {
      expect(() => generateTagHash('startup-protocol')).not.toThrow();
      expect(() => generateTagHash('claude-mem')).not.toThrow();
      
      // Should be deterministic
      const hash1 = generateTagHash('startup-protocol');
      const hash2 = generateTagHash('startup-protocol');
      expect(hash1).toBe(hash2);
    });
  });
});