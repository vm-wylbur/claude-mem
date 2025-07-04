// TDD Phase 2: Search Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';

export interface SearchParams {
  searchTerm: string;
}

export class SearchTool extends BaseMCPTool<SearchParams> {
  constructor(
    dbService: any,
    private formatHashForDisplayFunction: (hashId: string) => string
  ) {
    super(dbService);
  }

  async handle(params: SearchParams): Promise<MCPResponse> {
    try {
      const { searchTerm } = params;
      
      console.error('Searching for:', searchTerm);
      const memories = await this.dbService.findSimilarMemories(searchTerm, 5);
      console.error('Found memories:', memories.length);
      
      if (!memories.length) {
        return {
          content: [{
            type: 'text',
            text: 'No similar memories found.'
          }]
        };
      }

      const formattedResults = memories.map(memory => {
        const metadata = typeof memory.metadata === 'string' 
          ? JSON.parse(memory.metadata) 
          : memory.metadata;
        return {
          id: this.formatHashForDisplayFunction(memory.memory_id),  // Display as hex
          similarity: `${((memory.similarity || 0) * 100).toFixed(1)}%`,
          content: memory.content,
          type: memory.content_type,
          status: metadata.implementation_status,
          keyDecisions: metadata.key_decisions,
          created: memory.created_at
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(formattedResults, null, 2)
        }]
      };
    } catch (error) {
      console.error('Search error:', error);
      return this.handleError(error, 'search');
    }
  }
}