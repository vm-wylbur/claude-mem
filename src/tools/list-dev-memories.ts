// TDD Phase 2: List Dev Memories Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

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
      
      // Pass limit directly to database for efficient pagination
      const memories = await this.dbService.getDevMemories(limit);

      if (tag) {
        // TODO: Implement proper tag filtering using database queries
        console.error(`Note: Tag filtering for "${tag}" not yet implemented in list operation`);
        // For now, filter in memory but only on the already-limited results
        const filtered = memories.filter(memory => {
          // This is a placeholder - proper implementation should use SQL filtering
          return true; // TODO: implement tag filtering at DB level
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(filtered.map(memory => ({
              ...memory,
              memory_id: formatHashForDisplay(memory.memory_id)
            })), null, 2)
          }]
        };
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