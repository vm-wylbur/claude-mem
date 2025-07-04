// TDD Phase 2: List Memories By Tag Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';

export interface ListMemoriesByTagParams {
  tagName: string;
  limit?: number;
}

export class ListMemoriesByTagTool extends BaseMCPTool<ListMemoriesByTagParams> {
  constructor(
    dbService: any,
    private formatHashForDisplayFunction: (hashId: string) => string
  ) {
    super(dbService);
  }

  async handle(params: ListMemoriesByTagParams): Promise<MCPResponse> {
    try {
      const { tagName, limit = 10 } = params;
      
      const memories = await this.dbService.getDevMemoriesByTag(tagName, limit);
      
      if (!memories.length) {
        return {
          content: [{
            type: 'text',
            text: `No memories found with tag "${tagName}".`
          }]
        };
      }

      // Format memories with hex IDs for display
      const displayMemories = memories.map(memory => ({
        ...memory,
        memory_id: this.formatHashForDisplayFunction(memory.memory_id)
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(displayMemories, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'listing memories by tag');
    }
  }
}