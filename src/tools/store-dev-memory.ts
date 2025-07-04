// TDD Phase 2: Store Dev Memory Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { MemoryType } from '../db/service.js';
import { formatHashForDisplay } from '../utils/hash.js';

export interface StoreDevMemoryParams {
  content: string;
  type: 'conversation' | 'code' | 'decision' | 'reference';
  keyDecisions?: string[];
  status?: string;
  codeChanges?: string[];
  filesCreated?: string[];
  tags?: string[];
}

export class StoreDevMemoryTool extends BaseMCPTool<StoreDevMemoryParams> {
  constructor(
    dbService: any,
    private storeMemoryWithTagsFunction: (content: string, type: MemoryType, metadata: any, tags?: string[]) => Promise<string>
  ) {
    super(dbService);
  }

  async handle(params: StoreDevMemoryParams): Promise<MCPResponse> {
    try {
      const { content, type, keyDecisions, status, codeChanges, filesCreated, tags } = params;
      
      // Use shared storage function
      const memoryId = await this.storeMemoryWithTagsFunction(content, type as MemoryType, {
        key_decisions: keyDecisions,
        implementation_status: status,
        code_changes: codeChanges,
        files_created: filesCreated,
        date: new Date().toISOString()
      }, tags);

      return {
        content: [{
          type: 'text',
          text: `Successfully stored memory with ID: ${formatHashForDisplay(memoryId)}`
        }]
      };
    } catch (error) {
      return this.handleError(error, 'store-dev-memory');
    }
  }
}