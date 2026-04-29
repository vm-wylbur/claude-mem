// queue-fix-store: writer-side tool. Append a queue_fix entry recording
// a direct fix made on a host that needs to be encoded into IaC.
//
// Author: PB and Claude
// Date: 2026-04-29
// License: (c) HRDAG, 2026, GPL-2 or newer

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { DatabaseService, QueueFixInput } from '../db/service.js';

export interface QueueFixStoreParams {
  target_repo: string;
  host: string;
  path: string;
  before_state?: string;
  after_state: string;
  why: string;
  suggested_role?: string;
  who: string;
  trust?: string;
  metadata?: Record<string, unknown>;
}

export class QueueFixStoreTool extends BaseMCPTool<QueueFixStoreParams> {
  constructor(dbService: DatabaseService) {
    super(dbService);
  }

  async handle(params: QueueFixStoreParams): Promise<MCPResponse> {
    try {
      const input: QueueFixInput = {
        target_repo: params.target_repo,
        host: params.host,
        path: params.path,
        before_state: params.before_state,
        after_state: params.after_state,
        why: params.why,
        suggested_role: params.suggested_role,
        who: params.who,
        trust: params.trust,
        metadata: params.metadata,
      };
      const id = await this.dbService.createQueueFix(input);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                id,
                target_repo: params.target_repo,
                host: params.host,
                path: params.path,
                status: 'open',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return this.handleError(error, 'queue-fix-store');
    }
  }
}
