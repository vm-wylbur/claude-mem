// queue-fix-list: drainer-side tool. List queue_fix entries by
// target_repo + status. Returns ALL matches (no relevance ranking),
// ordered created_at ASC (FIFO drain order).
//
// Author: PB and Claude
// Date: 2026-04-29
// License: (c) HRDAG, 2026, GPL-2 or newer

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { DatabaseService } from '../db/service.js';
import { QueueFixStatus } from '../db/adapters/base.js';

export interface QueueFixListParams {
  target_repo?: string;
  status?: QueueFixStatus;
  host?: string;
  limit?: number;
}

export class QueueFixListTool extends BaseMCPTool<QueueFixListParams> {
  constructor(dbService: DatabaseService) {
    super(dbService);
  }

  async handle(params: QueueFixListParams): Promise<MCPResponse> {
    try {
      const entries = await this.dbService.listQueueFixes({
        target_repo: params.target_repo,
        status: params.status ?? 'open',
        host: params.host,
        limit: params.limit ?? 50,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: entries.length,
                entries,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return this.handleError(error, 'queue-fix-list');
    }
  }
}
