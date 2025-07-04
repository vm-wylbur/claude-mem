// TDD Phase 2: Base Tool Class (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { DatabaseService } from '../db/service.js';
import { MCPErrorResponse, createErrorResponse } from '../utils/error-response.js';

export interface MCPResponse {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
  [key: string]: unknown; // Allow additional MCP SDK properties
}

export abstract class BaseMCPTool<TParams = any> {
  constructor(protected dbService: DatabaseService) {}

  abstract handle(params?: TParams): Promise<MCPResponse>;

  protected handleError(error: unknown, context: string): MCPErrorResponse {
    return createErrorResponse(error, context);
  }
}