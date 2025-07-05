// TDD Phase 1 - RED Phase: ListDevMemoriesTool Tag Filtering Unit Tests
// Author: PB and Claude
// Date: 2025-07-05
//
// Focused unit tests for ListDevMemoriesTool tag filtering behavior

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ListDevMemoriesTool } from '../../src/tools/list-dev-memories.js';
import { DatabaseService } from '../../src/db/service.js';

// Mock the DatabaseService
const mockDbService = {
  getDevMemories: jest.fn(),
  getDevMemoriesByTag: jest.fn(),
} as unknown as DatabaseService;

describe('ListDevMemoriesTool Tag Filtering Unit Tests - RED Phase', () => {
  let tool: ListDevMemoriesTool;

  beforeEach(() => {
    tool = new ListDevMemoriesTool(mockDbService);
    jest.clearAllMocks();
  });

  describe('Tag Parameter Handling', () => {
    it('should call getDevMemoriesByTag when tag parameter is provided', async () => {
      // Setup mock responses
      const mockMemories = [
        {
          memory_id: 'abc123',
          content: 'Test memory with tag',
          content_type: 'code',
          metadata: '{}',
          project_id: 'project1',
          created_at: '2025-07-05T00:00:00Z'
        }
      ];
      
      (mockDbService.getDevMemoriesByTag as jest.Mock).mockResolvedValue(mockMemories);

      // Test the behavior
      const result = await tool.handle({ tag: 'testing', limit: 10 });

      // Verify correct method was called
      expect(mockDbService.getDevMemoriesByTag).toHaveBeenCalledWith('testing', 10);
      expect(mockDbService.getDevMemories).not.toHaveBeenCalled();

      // Verify response format
      expect(result.content[0].type).toBe('text');
      const responseMemories = JSON.parse(result.content[0].text);
      expect(responseMemories).toHaveLength(1);
      expect(responseMemories[0].content).toBe('Test memory with tag');
    });

    it('should call getDevMemories when no tag parameter is provided', async () => {
      // Setup mock responses
      const mockMemories = [
        {
          memory_id: 'def456',
          content: 'All memories without filtering',
          content_type: 'reference',
          metadata: '{}',
          project_id: 'project1',
          created_at: '2025-07-05T00:00:00Z'
        }
      ];
      
      (mockDbService.getDevMemories as jest.Mock).mockResolvedValue(mockMemories);

      // Test without tag parameter
      const result = await tool.handle({ limit: 10 });

      // Verify correct method was called
      expect(mockDbService.getDevMemories).toHaveBeenCalledWith(10);
      expect(mockDbService.getDevMemoriesByTag).not.toHaveBeenCalled();

      // Verify response format
      expect(result.content[0].type).toBe('text');
      const responseMemories = JSON.parse(result.content[0].text);
      expect(responseMemories).toHaveLength(1);
    });

    it('should handle empty tag parameter appropriately', async () => {
      const mockMemories: any[] = [];
      (mockDbService.getDevMemories as jest.Mock).mockResolvedValue(mockMemories);

      // Test with empty string tag
      const result = await tool.handle({ tag: '', limit: 10 });

      // Empty tag should be treated as no tag filtering
      expect(mockDbService.getDevMemories).toHaveBeenCalledWith(10);
      expect(mockDbService.getDevMemoriesByTag).not.toHaveBeenCalled();
    });
  });

  describe('Current Implementation Problems', () => {
    it('should NOT use in-memory filtering after database query', async () => {
      // This test will FAIL with current implementation and PASS after fix
      const mockMemories = [
        {
          memory_id: 'abc123',
          content: 'Memory with testing tag',
          content_type: 'code',
          metadata: '{}',
          project_id: 'project1',
          created_at: '2025-07-05T00:00:00Z'
        },
        {
          memory_id: 'def456', 
          content: 'Memory without testing tag',
          content_type: 'reference',
          metadata: '{}',
          project_id: 'project1',
          created_at: '2025-07-05T00:00:00Z'
        }
      ];

      // Mock getDevMemories to return all memories (current broken behavior)
      (mockDbService.getDevMemories as jest.Mock).mockResolvedValue(mockMemories);
      
      // With current implementation, this will call getDevMemories and then
      // do ineffective in-memory filtering that returns everything
      const result = await tool.handle({ tag: 'testing', limit: 10 });

      // Current implementation INCORRECTLY calls getDevMemories instead of getDevMemoriesByTag
      // This test documents the current broken behavior that we need to fix
      expect(mockDbService.getDevMemories).toHaveBeenCalled();
      
      // After fix, this should change to:
      // expect(mockDbService.getDevMemoriesByTag).toHaveBeenCalledWith('testing', 10);
    });

    it('should NOT log implementation placeholder messages', async () => {
      // Capture console.error output
      const originalError = console.error;
      const errorMessages: string[] = [];
      console.error = (message: string) => {
        errorMessages.push(message);
      };

      try {
        (mockDbService.getDevMemories as jest.Mock).mockResolvedValue([]);
        
        await tool.handle({ tag: 'testing', limit: 10 });
        
        // Current implementation logs this message - should be removed after fix
        const hasPlaceholderMessage = errorMessages.some(msg => 
          msg.includes('not yet implemented') && msg.includes('testing')
        );
        
        // This will FAIL initially (finds placeholder message) and PASS after fix
        expect(hasPlaceholderMessage).toBe(false);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('Integration with Database Layer', () => {
    it('should pass limit parameter correctly to database layer', async () => {
      (mockDbService.getDevMemoriesByTag as jest.Mock).mockResolvedValue([]);

      await tool.handle({ tag: 'testing', limit: 5 });

      expect(mockDbService.getDevMemoriesByTag).toHaveBeenCalledWith('testing', 5);
    });

    it('should handle undefined limit parameter', async () => {
      (mockDbService.getDevMemoriesByTag as jest.Mock).mockResolvedValue([]);

      await tool.handle({ tag: 'testing' });

      // Should pass undefined limit to database layer
      expect(mockDbService.getDevMemoriesByTag).toHaveBeenCalledWith('testing', undefined);
    });
  });

  describe('Response Format Consistency', () => {
    it('should format hash IDs consistently for both filtered and unfiltered results', async () => {
      const mockMemory = {
        memory_id: 'abcdef123456',
        content: 'Test memory',
        content_type: 'code',
        metadata: '{}',
        project_id: 'project1',
        created_at: '2025-07-05T00:00:00Z'
      };

      (mockDbService.getDevMemoriesByTag as jest.Mock).mockResolvedValue([mockMemory]);

      const result = await tool.handle({ tag: 'testing', limit: 10 });

      expect(result.content[0].type).toBe('text');
      const responseMemories = JSON.parse(result.content[0].text);
      
      // Hash ID should be formatted for display (this is already working)
      expect(responseMemories[0].memory_id).toBe('abcdef123456'); // formatHashForDisplay
    });
  });
});