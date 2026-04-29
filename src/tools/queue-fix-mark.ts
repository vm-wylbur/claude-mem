// queue-fix-mark: drainer-side outcome tool. Mark a queue_fix entry
// consumed (encoded into IaC), escalated (cannot auto-encode; needs
// human triage), or superseded (replaced by a later entry).
//
// Author: PB and Claude
// Date: 2026-04-29
// License: (c) HRDAG, 2026, GPL-2 or newer

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { DatabaseService } from '../db/service.js';

export interface QueueFixMarkParams {
  id: number;
  status: 'consumed' | 'escalated' | 'superseded';
  consumed_by_commit?: string;
  consumed_in_repo?: string;
  consumed_in_path?: string;
  escalation_reason?: string;
  superseded_by?: number;
}

export class QueueFixMarkTool extends BaseMCPTool<QueueFixMarkParams> {
  constructor(dbService: DatabaseService) {
    super(dbService);
  }

  async handle(params: QueueFixMarkParams): Promise<MCPResponse> {
    try {
      switch (params.status) {
        case 'consumed': {
          if (!params.consumed_by_commit || !params.consumed_in_repo || !params.consumed_in_path) {
            throw new Error(
              'queue-fix-mark consumed requires consumed_by_commit, consumed_in_repo, consumed_in_path'
            );
          }
          await this.dbService.markQueueFixConsumed(params.id, {
            commit: params.consumed_by_commit,
            repo: params.consumed_in_repo,
            path: params.consumed_in_path,
          });
          break;
        }
        case 'escalated': {
          if (!params.escalation_reason) {
            throw new Error('queue-fix-mark escalated requires escalation_reason');
          }
          await this.dbService.markQueueFixEscalated(params.id, params.escalation_reason);
          break;
        }
        case 'superseded': {
          if (params.superseded_by === undefined) {
            throw new Error('queue-fix-mark superseded requires superseded_by id');
          }
          await this.dbService.markQueueFixSuperseded(params.id, params.superseded_by);
          break;
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                id: params.id,
                status: params.status,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return this.handleError(error, 'queue-fix-mark');
    }
  }
}
