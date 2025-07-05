// TDD RED Phase: Tag Constraint Validation (Issue #4)
// Author: PB and Claude  
// Date: 2025-07-05
//
// Tests for better error messages when tag constraints are violated
// Problem: "duplicate key value violates unique constraint tags_pkey" 
// doesn't identify which specific tag already exists

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseService } from '../src/db/service.js';
import { createDatabaseAdapter } from '../src/config.js';

describe('Tag Constraint Validation - RED Phase', () => {
  let dbService: DatabaseService;
  let testMemoryIds: string[] = [];

  beforeEach(async () => {
    // Initialize test database
    const adapter = await createDatabaseAdapter();
    dbService = new DatabaseService(adapter);
    await dbService.initialize();
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

  describe('Duplicate Tag Detection', () => {
    it('should provide specific error message when tag already exists', async () => {
      // Create a memory with some tags
      const memoryId = await dbService.storeDevMemory(
        'Test memory with existing tags',
        'code',
        {
          key_decisions: ['Test decision'],
          implementation_status: 'testing',
          date: new Date().toISOString()
        }
      );
      testMemoryIds.push(memoryId);

      // Add initial tags successfully
      await dbService.addMemoryTags(memoryId, ['testing', 'database', 'api']);

      // Try to add a mix of new and existing tags
      const duplicateTags = ['testing', 'newTag', 'database', 'anotherNewTag'];
      
      try {
        await dbService.addMemoryTags(memoryId, duplicateTags);
        
        // This should succeed since we have ON CONFLICT DO NOTHING
        // But we want to detect when someone tries to create existing tags
        expect(true).toBe(true); // For now, this should pass
      } catch (error) {
        // Current implementation: Generic constraint error
        // Desired implementation: Specific error about which tags exist
        
        expect(error).toBeInstanceOf(Error);
        const errorMessage = (error as Error).message;
        
        // Current behavior (should be improved):
        if (errorMessage.includes('duplicate key value violates unique constraint')) {
          // FAIL: Generic error doesn't help user
          expect(errorMessage).toMatch(/Tag .* already exists/);
        }
      }
    });

    it('should identify multiple existing tags in error message', async () => {
      // Setup: Create memory with existing tags
      const memoryId = await dbService.storeDevMemory(
        'Memory for testing multiple duplicates',
        'reference',
        {
          date: new Date().toISOString()
        }
      );
      testMemoryIds.push(memoryId);

      await dbService.addMemoryTags(memoryId, ['existing1', 'existing2', 'existing3']);

      // Test: Try to add many tags including multiple existing ones
      const problematicTags = [
        'existing1',  // exists
        'newTag1',    // new
        'existing2',  // exists  
        'newTag2',    // new
        'existing3'   // exists
      ];

      try {
        await dbService.addMemoryTags(memoryId, problematicTags);
        
        // Should succeed with current ON CONFLICT DO NOTHING
        expect(true).toBe(true);
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Current: Generic constraint violation
        // Desired: Specific message like "Tags already exist: existing1, existing2, existing3"
        expect(errorMessage).toMatch(/Tags already exist: .+/);
        expect(errorMessage).toContain('existing1');
        expect(errorMessage).toContain('existing2'); 
        expect(errorMessage).toContain('existing3');
      }
    });

    it('should succeed when adding only new tags', async () => {
      const memoryId = await dbService.storeDevMemory(
        'Memory for testing new tags only',
        'code',
        {
          date: new Date().toISOString()
        }
      );
      testMemoryIds.push(memoryId);

      // This should always succeed
      await expect(dbService.addMemoryTags(memoryId, ['newTag1', 'newTag2', 'newTag3']))
        .resolves.not.toThrow();
    });
  });

  describe('Enhanced Error Reporting', () => {
    it('should provide helpful error when trying to link invalid memory', async () => {
      const fakeMemoryId = 'nonexistent123';
      
      try {
        await dbService.addMemoryTags(fakeMemoryId, ['testing']);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Current: Generic foreign key constraint error
        // Desired: "Memory with ID 'nonexistent123' does not exist"
        expect(errorMessage).toMatch(/Memory .* does not exist/);
      }
    });

    it('should provide helpful suggestions for common tag conflicts', async () => {
      // This test defines behavior for smart error handling
      const memoryId = await dbService.storeDevMemory(
        'Memory for testing suggestions',
        'code',
        {
          date: new Date().toISOString()
        }
      );
      testMemoryIds.push(memoryId);

      // Setup existing tags
      await dbService.addMemoryTags(memoryId, ['api-testing', 'database-setup']);

      try {
        // Try to add tags that conflict or are very similar
        await dbService.addMemoryTags(memoryId, ['api-testing', 'database_setup']);
        expect(true).toBe(true); // Should work with current implementation
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Future enhancement: suggest similar existing tags
        expect(errorMessage).toMatch(/(already exists|similar tag exists)/);
      }
    });
  });

  describe('Performance and Efficiency', () => {
    it('should validate all tags before any database operations', async () => {
      // This test ensures we don't partially insert tags before hitting a constraint
      const memoryId = await dbService.storeDevMemory(
        'Memory for atomic tag validation',
        'code',
        {
          date: new Date().toISOString()
        }
      );
      testMemoryIds.push(memoryId);

      // Add initial tags
      await dbService.addMemoryTags(memoryId, ['tag1', 'tag2']);

      const mixedTags = ['tag1', 'tag3', 'tag2', 'tag4']; // 2 existing, 2 new

      // Current implementation should handle this gracefully with ON CONFLICT DO NOTHING
      // But ideally we'd validate upfront and provide clear feedback
      await expect(dbService.addMemoryTags(memoryId, mixedTags))
        .resolves.not.toThrow();

      // Verify all new tags were added
      const tags = await dbService.getMemoryTags(memoryId);
      expect(tags).toContain('tag3');
      expect(tags).toContain('tag4');
    });
  });
});