// TDD Phase 2: Get Dev Memory Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';

export interface GetDevMemoryParams {
  memoryId: string;
}

export class GetDevMemoryTool extends BaseMCPTool<GetDevMemoryParams> {
  constructor(
    dbService: any,
    private parseHexToHashFunction: (hexId: string) => string,
    private isValidHashIdFunction: (hashId: string) => boolean,
    private formatHashForDisplayFunction: (hashId: string) => string
  ) {
    super(dbService);
  }

  async handle(params: GetDevMemoryParams): Promise<MCPResponse> {
    try {
      const { memoryId } = params;
      
      // Convert hex format to hash ID for database lookup
      let hashId: string;
      try {
        hashId = this.parseHexToHashFunction(memoryId);
        if (!this.isValidHashIdFunction(hashId)) {
          throw new Error('Invalid hash format');
        }
      } catch {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Invalid memory ID format: ${memoryId}. Expected hex format like a1b2c3d4e5f67890`
          }]
        };
      }
      
      const memory = await this.dbService.getMemory(hashId);
      if (!memory) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Memory with ID ${memoryId} not found`
          }]
        };
      }

      // Format memory with hex ID for display
      const displayMemory = {
        ...memory,
        memory_id: this.formatHashForDisplayFunction(memory.memory_id)
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(displayMemory, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'get-dev-memory');
    }
  }
}