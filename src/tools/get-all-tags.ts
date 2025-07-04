// TDD Phase 2: Get All Tags Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';

export class GetAllTagsTool extends BaseMCPTool {
  async handle(): Promise<MCPResponse> {
    try {
      const tags = await this.dbService.getDevTags();
      
      if (!tags.length) {
        return {
          content: [{
            type: 'text',
            text: 'No tags found in the memory system.'
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(tags, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'retrieving tags');
    }
  }
}