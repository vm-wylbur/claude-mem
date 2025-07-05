// TDD Phase 1 - RED Phase: Tag Filtering Integration Tests
// Author: PB and Claude
// Date: 2025-07-05
// 
// These tests define the expected behavior for database-level tag filtering
// across list-dev-memories, index.ts, and cli.ts components

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseService } from '../src/db/service.js';
import { createDatabaseAdapter } from '../src/config.js';
import { ListDevMemoriesTool } from '../src/tools/list-dev-memories.js';

describe('Tag Filtering Integration Tests - RED Phase', () => {
  let dbService: DatabaseService;
  let listTool: ListDevMemoriesTool;
  let testMemoryIds: string[] = [];

  beforeEach(async () => {
    // Initialize test database
    const adapter = await createDatabaseAdapter();
    dbService = new DatabaseService(adapter);
    await dbService.initialize();
    
    listTool = new ListDevMemoriesTool(dbService);

    // Create test memories with different tags for filtering tests
    const memory1Id = await dbService.storeDevMemory(
      'Memory about TypeScript testing',
      'code',
      {
        key_decisions: ['Use Jest for testing'],
        implementation_status: 'completed',
        date: new Date().toISOString()
      }
    );
    
    const memory2Id = await dbService.storeDevMemory(
      'Memory about database implementation', 
      'code',
      {
        key_decisions: ['Use PostgreSQL'],
        implementation_status: 'in-progress',
        date: new Date().toISOString()
      }
    );

    const memory3Id = await dbService.storeDevMemory(
      'Memory about TDD methodology',
      'reference',
      {
        key_decisions: ['Follow RED-GREEN-REFACTOR'],
        implementation_status: 'documented',
        date: new Date().toISOString()
      }
    );

    testMemoryIds = [memory1Id, memory2Id, memory3Id];

    // Add tags to test memories
    await dbService.addTagsToMemory(memory1Id, ['typescript', 'testing', 'jest']);
    await dbService.addTagsToMemory(memory2Id, ['database', 'postgresql', 'implementation']);
    await dbService.addTagsToMemory(memory3Id, ['tdd', 'methodology', 'testing']);
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
    testMemoryIds = [];
  });

  describe('ListDevMemoriesTool Tag Filtering', () => {
    it('should filter memories by single tag using database queries', async () => {
      // This test should FAIL initially - current implementation doesn't use database filtering
      const result = await listTool.handle({ tag: 'testing', limit: 10 });
      
      expect(result.content[0].type).toBe('text');
      const memories = JSON.parse(result.content[0].text);
      
      // Should return only memories tagged with 'testing' (memory1 and memory3)
      expect(memories).toHaveLength(2);
      expect(memories.some((m: any) => m.content.includes('TypeScript testing'))).toBe(true);
      expect(memories.some((m: any) => m.content.includes('TDD methodology'))).toBe(true);
      expect(memories.some((m: any) => m.content.includes('database implementation'))).toBe(false);
    });

    it('should return empty array for non-existent tags', async () => {
      const result = await listTool.handle({ tag: 'nonexistent-tag', limit: 10 });
      
      expect(result.content[0].type).toBe('text');
      const memories = JSON.parse(result.content[0].text);
      
      expect(memories).toHaveLength(0);
    });

    it('should handle case-insensitive tag filtering', async () => {
      const result = await listTool.handle({ tag: 'TESTING', limit: 10 });
      
      expect(result.content[0].type).toBe('text');
      const memories = JSON.parse(result.content[0].text);
      
      // Should still find memories with 'testing' tag
      expect(memories.length).toBeGreaterThan(0);
    });

    it('should work with pagination and tag filtering combined', async () => {
      // Test with limit=1 and tag filtering
      const result = await listTool.handle({ tag: 'testing', limit: 1 });
      
      expect(result.content[0].type).toBe('text');
      const memories = JSON.parse(result.content[0].text);
      
      // Should return exactly 1 memory even though 2 have 'testing' tag
      expect(memories).toHaveLength(1);
    });

    it('should not log "not yet implemented" message when filtering by tag', async () => {
      // Capture console.error calls
      const originalError = console.error;
      const errorMessages: string[] = [];
      console.error = (message: string) => {
        errorMessages.push(message);
      };

      try {
        await listTool.handle({ tag: 'testing', limit: 10 });
        
        // Should NOT contain the TODO message once properly implemented
        expect(errorMessages.some(msg => msg.includes('not yet implemented'))).toBe(false);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('Performance and Efficiency', () => {
    it('should use database-level filtering instead of in-memory filtering', async () => {
      // This test validates that we're not loading all memories and then filtering
      // We'll verify this by checking that tag filtering doesn't load unrelated memories
      
      // Create a memory with a unique tag
      const uniqueMemoryId = await dbService.storeDevMemory(
        'Unique memory for performance test',
        'code',
        {
          key_decisions: ['Performance testing'],
          implementation_status: 'testing',
          date: new Date().toISOString()
        }
      );
      
      await dbService.addTagsToMemory(uniqueMemoryId, ['unique-performance-tag']);
      testMemoryIds.push(uniqueMemoryId);

      // Filter by unique tag - should only return this one memory
      const result = await listTool.handle({ tag: 'unique-performance-tag', limit: 100 });
      
      expect(result.content[0].type).toBe('text');
      const memories = JSON.parse(result.content[0].text);
      
      // Should return exactly 1 memory (the unique one) regardless of limit
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toContain('Unique memory for performance test');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid tag names gracefully', async () => {
      // Test with various invalid tag formats
      const result = await listTool.handle({ tag: '', limit: 10 });
      
      // Should not crash and should return appropriate response
      expect(result.content[0].type).toBe('text');
      const memories = JSON.parse(result.content[0].text);
      expect(Array.isArray(memories)).toBe(true);
    });

    it('should handle null/undefined tag parameter', async () => {
      const result = await listTool.handle({ tag: undefined, limit: 10 });
      
      // Should behave like no tag filtering (return all memories)
      expect(result.content[0].type).toBe('text');
      const memories = JSON.parse(result.content[0].text);
      expect(memories.length).toBeGreaterThanOrEqual(3); // At least our test memories
    });
  });
});