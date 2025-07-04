// TDD Phase 2: Search Enhanced Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';

export interface SearchEnhancedParams {
  query: string;
  limit?: number;
  minSimilarity?: number;
  types?: ('conversation' | 'code' | 'decision' | 'reference')[];
  dateRange?: {
    from: string;
    to: string;
  };
  showScores?: boolean;
  includeTags?: boolean;
  sortBy?: 'similarity' | 'date' | 'type';
}

export class SearchEnhancedTool extends BaseMCPTool<SearchEnhancedParams> {
  constructor(
    dbService: any,
    private formatHashForDisplayFunction: (hashId: string) => string
  ) {
    super(dbService);
  }

  async handle(params: SearchEnhancedParams): Promise<MCPResponse> {
    try {
      const { query, limit = 5, minSimilarity = 0.1, types, dateRange, showScores = true, includeTags = true, sortBy = 'similarity' } = params;
      
      console.error('Enhanced search for:', query);
      
      // Get more results initially to allow for filtering
      const initialLimit = limit * 3;
      let memories = await this.dbService.findSimilarMemories(query, initialLimit);
      console.error('Found memories before filtering:', memories.length);
      
      // Apply similarity threshold
      memories = memories.filter(memory => (memory.similarity || 0) >= minSimilarity);
      
      // Apply type filter
      if (types && types.length > 0) {
        memories = memories.filter(memory => types.includes(memory.content_type as any));
      }
      
      // Apply date range filter
      if (dateRange) {
        const fromDate = new Date(dateRange.from);
        const toDate = new Date(dateRange.to);
        
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid date format in dateRange. Please use ISO format like "2025-07-02T10:00:00Z"`
            }]
          };
        }
        
        memories = memories.filter(memory => {
          const memoryDate = new Date(memory.created_at);
          return memoryDate >= fromDate && memoryDate <= toDate;
        });
      }
      
      // Sort results
      if (sortBy === 'date') {
        memories = memories.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      } else if (sortBy === 'type') {
        memories = memories.sort((a, b) => a.content_type.localeCompare(b.content_type));
      }
      // similarity is already sorted by default from findSimilarMemories
      
      // Apply final limit
      memories = memories.slice(0, limit);
      
      if (!memories.length) {
        return {
          content: [{
            type: 'text',
            text: `No memories found matching search criteria:\n- Query: "${query}"\n- Min similarity: ${minSimilarity}\n- Types: ${types?.join(', ') || 'all'}\n- Date range: ${dateRange ? `${dateRange.from} to ${dateRange.to}` : 'none'}`
          }]
        };
      }
      
      // Format results with optional enrichments
      const formattedResults = await Promise.all(memories.map(async memory => {
        const metadata = typeof memory.metadata === 'string' 
          ? JSON.parse(memory.metadata) 
          : memory.metadata;
        
        let tags: string[] = [];
        if (includeTags) {
          try {
            tags = await this.dbService.getMemoryTags(memory.memory_id);
          } catch (error) {
            console.error('Error getting tags for memory:', error);
          }
        }
        
        const result: any = {
          id: this.formatHashForDisplayFunction(memory.memory_id),
          type: memory.content_type,
          content: memory.content,
          status: metadata?.implementation_status,
          keyDecisions: metadata?.key_decisions,
          created: memory.created_at,
          age: `${Math.round((Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60))}h ago`
        };
        
        if (showScores) {
          result.similarity = `${((memory.similarity || 0) * 100).toFixed(1)}%`;
          result.score = (memory.similarity || 0).toFixed(3);
        }
        
        if (includeTags && tags.length > 0) {
          result.tags = tags;
        }
        
        return result;
      }));
      
      const searchSummary = {
        searchQuery: query,
        totalResults: memories.length,
        appliedFilters: {
          minSimilarity: minSimilarity,
          types: types || 'all',
          dateRange: dateRange || 'none',
          sortBy: sortBy
        },
        resultRange: {
          topSimilarity: showScores ? `${((memories[0]?.similarity || 0) * 100).toFixed(1)}%` : 'hidden',
          lowestSimilarity: showScores ? `${((memories[memories.length - 1]?.similarity || 0) * 100).toFixed(1)}%` : 'hidden'
        }
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            searchSummary,
            results: formattedResults
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'enhanced search');
    }
  }
}