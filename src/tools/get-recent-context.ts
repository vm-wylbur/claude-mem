// TDD Phase 2: Get Recent Context Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { formatHashForDisplay } from '../utils/hash.js';

export interface GetRecentContextParams {
  limit?: number;
  since?: string;
  types?: ('conversation' | 'code' | 'decision' | 'reference')[];
  includeTags?: boolean;
  format?: 'full' | 'summary' | 'context';
}

export class GetRecentContextTool extends BaseMCPTool<GetRecentContextParams> {
  async handle(params: GetRecentContextParams = {}): Promise<MCPResponse> {
    try {
      const { limit = 5, since, types, includeTags = true, format = 'context' } = params;
      
      // Get recent memories with efficient pagination
      let memories = await this.dbService.getDevMemories(limit * 2); // Get extra to allow for filtering
      
      // Apply date filter if provided
      if (since) {
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid date format: ${since}. Please use ISO format like "2025-07-02T10:00:00Z"`
            }]
          };
        }
        memories = memories.filter(memory => new Date(memory.created_at) > sinceDate);
      }
      
      // Apply type filter if provided
      if (types && types.length > 0) {
        memories = memories.filter(memory => types.includes(memory.content_type as any));
      }
      
      // Limit results after filtering
      memories = memories.slice(0, limit);
      
      if (!memories.length) {
        return {
          content: [{
            type: 'text',
            text: 'No recent memories found matching the specified criteria.'
          }]
        };
      }
      
      // Format results based on requested format
      let formattedMemories;
      
      if (format === 'full') {
        formattedMemories = memories.map(memory => ({
          ...memory,
          memory_id: formatHashForDisplay(memory.memory_id)
        }));
      } else if (format === 'summary') {
        formattedMemories = memories.map(memory => {
          const metadata = typeof memory.metadata === 'string' 
            ? JSON.parse(memory.metadata) 
            : memory.metadata;
          return {
            id: formatHashForDisplay(memory.memory_id),
            type: memory.content_type,
            preview: memory.content.substring(0, 150) + (memory.content.length > 150 ? '...' : ''),
            status: metadata?.implementation_status,
            created: memory.created_at
          };
        });
      } else { // format === 'context'
        formattedMemories = await Promise.all(memories.map(async memory => {
          const metadata = typeof memory.metadata === 'string' 
            ? JSON.parse(memory.metadata) 
            : memory.metadata;
          
          // Get tags if requested
          let tags: string[] = [];
          if (includeTags) {
            try {
              tags = await this.dbService.getMemoryTags(memory.memory_id);
            } catch (error) {
              // Continue without tags if there's an error
              console.error('Error getting tags for memory:', error);
            }
          }
          
          return {
            id: formatHashForDisplay(memory.memory_id),
            type: memory.content_type,
            content: memory.content,
            status: metadata?.implementation_status,
            keyDecisions: metadata?.key_decisions,
            tags: tags,
            created: memory.created_at,
            age: `${Math.round((Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60))}h ago`
          };
        }));
      }
      
      const response = {
        contextSummary: {
          totalMemories: memories.length,
          dateRange: {
            oldest: memories[memories.length - 1]?.created_at,
            newest: memories[0]?.created_at
          },
          types: [...new Set(memories.map(m => m.content_type))],
          filter: {
            since: since || 'none',
            types: types || 'all',
            limit: limit
          }
        },
        memories: formattedMemories
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'get-recent-context');
    }
  }
}