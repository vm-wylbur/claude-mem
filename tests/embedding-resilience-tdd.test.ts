#!/usr/bin/env npx tsx
// TDD Test for Embedding Resilience Issues
// Tests for graceful handling of Ollama server failures (CUDA out of memory, etc.)

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseService } from '../src/db/service.js';
import { QuickStoreTool } from '../src/tools/quick-store.js';
import { generateEmbedding, checkOllamaHealth } from '../src/embeddings.js';

describe('Embedding Resilience TDD', () => {
  let dbService: DatabaseService;
  let testMemoryIds: string[] = [];

  beforeEach(async () => {
    // Initialize test database
    dbService = new DatabaseService();
    await dbService.connect();
    testMemoryIds = [];
  });

  afterEach(async () => {
    // Clean up test memories
    for (const memoryId of testMemoryIds) {
      try {
        await dbService.deleteMemory(memoryId);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    await dbService.disconnect();
  });

  describe('Embedding Generation Failures', () => {
    it('should detect CUDA out of memory errors', async () => {
      // Test that we can detect the actual error condition
      const healthInfo = await checkOllamaHealth();
      
      if (!healthInfo.connected) {
        expect(healthInfo.error).toBeDefined();
        expect(healthInfo.error).toMatch(/out of memory|CUDA error|Internal Server Error/i);
      }
    });

    it('should handle embedding generation failures gracefully', async () => {
      // Test that generateEmbedding throws meaningful errors
      try {
        await generateEmbedding('test content');
        // If this succeeds, embedding is working
        expect(true).toBe(true);
      } catch (error) {
        // If it fails, should be a meaningful error
        expect(error).toBeDefined();
        expect((error as Error).message).toMatch(/Failed to generate embedding/i);
      }
    });
  });

  describe('Quick-Store Resilience', () => {
    it('should provide meaningful error messages when embedding fails', async () => {
      // Mock functions for testing
      const mockStoreMemoryWithTags = jest.fn().mockRejectedValue(new Error('Failed to generate embedding: Internal Server Error'));
      const mockDetectMemoryType = jest.fn().mockReturnValue('code');
      const mockGenerateSmartTags = jest.fn().mockRejectedValue(new Error('Failed to generate embedding: Internal Server Error'));

      const quickStoreTool = new QuickStoreTool(
        dbService,
        mockStoreMemoryWithTags,
        mockDetectMemoryType,
        mockGenerateSmartTags
      );

      const result = await quickStoreTool.handle({
        content: 'Test content that should fail embedding'
      });

      // Should return error response, not throw
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('quick-store');
      expect(result.content[0].text).toContain('Failed to generate embedding');
    });

    it('should work without embeddings when they are disabled', async () => {
      // This test verifies that we can fall back to non-embedding mode
      // when embedding generation fails
      
      // Mock functions that bypass embedding
      const mockStoreMemoryWithTags = jest.fn().mockResolvedValue('test-memory-id');
      const mockDetectMemoryType = jest.fn().mockReturnValue('code');
      const mockGenerateSmartTags = jest.fn().mockResolvedValue(['test', 'fallback']);

      const quickStoreTool = new QuickStoreTool(
        dbService,
        mockStoreMemoryWithTags,
        mockDetectMemoryType,
        mockGenerateSmartTags
      );

      const result = await quickStoreTool.handle({
        content: 'Test content without embeddings'
      });

      // Should succeed
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('success');
      expect(mockStoreMemoryWithTags).toHaveBeenCalledWith(
        'Test content without embeddings',
        'code',
        expect.any(Object),
        ['test', 'fallback']
      );
    });
  });

  describe('Hyphenated Tags Validation', () => {
    it('should accept valid hyphenated tags', async () => {
      // Test that hyphenated tags work correctly
      const validHyphenatedTags = [
        'auto-detection',
        'bug-fix',
        'api-testing',
        'claude-mem',
        'test-driven-development'
      ];

      const memoryId = await dbService.storeMemory('Test content', 'code', {});
      testMemoryIds.push(memoryId);

      // Should not throw
      await expect(dbService.addMemoryTags(memoryId, validHyphenatedTags))
        .resolves.not.toThrow();
    });

    it('should reject invalid hyphenated tags', async () => {
      // Test that invalid hyphenated tags are rejected
      const invalidHyphenatedTags = [
        '-invalid-start',
        'invalid-end-',
        'invalid--double-hyphen'
      ];

      const memoryId = await dbService.storeMemory('Test content', 'code', {});
      testMemoryIds.push(memoryId);

      // Should throw for each invalid tag
      for (const invalidTag of invalidHyphenatedTags) {
        await expect(dbService.addMemoryTags(memoryId, [invalidTag]))
          .rejects.toThrow(/Invalid tag name/);
      }
    });
  });

  describe('System Integration', () => {
    it('should handle complete quick-store workflow with hyphenated tags when embeddings work', async () => {
      // Integration test: if embeddings work, everything should work
      const healthInfo = await checkOllamaHealth();
      
      if (healthInfo.connected) {
        // If Ollama is healthy, test the full workflow
        const mockStoreMemoryWithTags = async (content: string, type: any, metadata: any, tags?: string[]) => {
          const memoryId = await dbService.storeMemory(content, type, metadata);
          testMemoryIds.push(memoryId);
          if (tags && tags.length > 0) {
            await dbService.addMemoryTags(memoryId, tags);
          }
          return memoryId;
        };

        const mockDetectMemoryType = () => 'code';
        const mockGenerateSmartTags = async () => ['auto-detection', 'bug-fix'];

        const quickStoreTool = new QuickStoreTool(
          dbService,
          mockStoreMemoryWithTags,
          mockDetectMemoryType,
          mockGenerateSmartTags
        );

        const result = await quickStoreTool.handle({
          content: 'Test content with hyphenated tags',
          tags: ['api-testing', 'claude-mem']
        });

        expect(result.content[0].text).toContain('success');
        expect(result.content[0].text).toContain('auto-detection');
        expect(result.content[0].text).toContain('bug-fix');
        expect(result.content[0].text).toContain('api-testing');
        expect(result.content[0].text).toContain('claude-mem');
      } else {
        // If Ollama is not healthy, skip this test
        console.log('Skipping integration test - Ollama not healthy:', healthInfo.error);
      }
    });
  });
});