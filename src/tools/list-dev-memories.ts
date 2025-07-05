// List Dev Memories Tool with Database-Level Tag Filtering
// Author: PB and Claude
// Date: 2025-07-05
//
// TDD Implementation completed: RED → GREEN → REFACTOR
// Features: Efficient database-level tag filtering, hash ID formatting

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { formatHashForDisplay } from '../utils/hash.js';

export interface ListDevMemoriesParams {
  limit?: number;
  tag?: string;
}

export class ListDevMemoriesTool extends BaseMCPTool<ListDevMemoriesParams> {
  async handle(params: ListDevMemoriesParams = {}): Promise<MCPResponse> {
    try {
      const { limit = 10, tag } = params;
      
      let memories;
      
      if (tag && tag.trim() !== '') {
        // Use database-level tag filtering for efficiency
        memories = await this.dbService.getDevMemoriesByTag(tag, limit);
      } else {
        // No tag filtering - get all memories
        memories = await this.dbService.getDevMemories(limit);
      }
      
      // Format memories with hex IDs for display
      const displayMemories = memories.map(memory => ({
        ...memory,
        memory_id: formatHashForDisplay(memory.memory_id)
      }));
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(displayMemories, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'list-dev-memories');
    }
  }
}