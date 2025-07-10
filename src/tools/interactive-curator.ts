// Interactive Memory Curation System
// Author: PB and Claude
// Date: 2025-07-08
// License: (c) HRDAG, 2025, GPL-2 or newer

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { MultiAIAnalyzeMemoryQualityTool, MultiAIAnalysis } from './multi-ai-analyze-memory-quality.js';
import { Memory } from '../db/service.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Curation Session Interfaces
// ============================================

export interface CurationItem {
  itemId: string;
  type: 'delete' | 'connect' | 'enhance' | 'extract-pattern';
  status: 'pending' | 'queued' | 'skipped' | 'rejected';
  confidence: number;
  memoryId?: string;
  memoryIds?: string[];
  recommendation: string;
  agentFindings: string[];
  metadata: any;
}

export interface CurationSession {
  sessionId: string;
  createdAt: string;
  analysisResults: MultiAIAnalysis[];
  triageItems: CurationItem[];
  triageState: {
    currentItemId?: string;
    currentMode: 'all' | 'delete' | 'connect' | 'enhance' | 'extract-pattern';
    currentIndex: number;
    history: string[];
  };
  actionQueues: {
    deletions: string[];
    connections: string[];
    enhancements: string[];
    patterns: string[];
  };
}

export interface CurationParams {
  sessionFile?: string;
  mode?: 'all' | 'delete' | 'connect' | 'enhance' | 'extract-pattern';
  limit?: number;
  includeCodeCheck?: boolean;
  codebaseRoot?: string;
}

// ============================================
// Interactive Curator Tool
// ============================================

export class InteractiveCuratorTool extends BaseMCPTool {
  private multiAITool: MultiAIAnalyzeMemoryQualityTool;
  private sessionFile: string;
  
  constructor(dbService: any, sessionFile = '.curation_session.json') {
    super(dbService);
    this.multiAITool = new MultiAIAnalyzeMemoryQualityTool(dbService, true);
    this.sessionFile = path.resolve(sessionFile);
  }

  async handle(params: CurationParams = {}): Promise<MCPResponse> {
    try {
      const command = (params as any).command || 'start';
      
      switch (command) {
        case 'start':
          return await this.startCurationSession(params);
        case 'next':
          return await this.nextItem(params);
        case 'details':
          return await this.showDetails(params);
        case 'queue':
          return await this.manageQueue(params);
        case 'status':
          return await this.showStatus();
        case 'mode':
          return await this.switchMode(params);
        case 'execute':
          return await this.executeQueues(params);
        default:
          return await this.showHelp();
      }
    } catch (error) {
      return this.handleError(error, 'Interactive curation failed');
    }
  }

  /**
   * Start a new curation session or resume existing one
   */
  private async startCurationSession(params: CurationParams): Promise<MCPResponse> {
    let session: CurationSession;
    
    if (fs.existsSync(this.sessionFile)) {
      // Resume existing session
      session = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      
      const pendingCount = session.triageItems.filter(item => item.status === 'pending').length;
      const queuedCount = Object.values(session.actionQueues).flat().length;
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: "📋 Resuming Curation Session",
            sessionId: session.sessionId,
            status: {
              totalItems: session.triageItems.length,
              pending: pendingCount,
              queued: queuedCount,
              currentMode: session.triageState.currentMode
            },
            nextSteps: [
              "Use 'next' to continue triage",
              "Use 'status' to see progress",
              "Use 'mode <type>' to change focus",
              "Use 'queue status' to review queued actions"
            ]
          }, null, 2)
        }]
      };
    }
    
    // Create new session - run multi-AI analysis
    const analysisResult = await this.multiAITool.handle({
      limit: params.limit || 50,
      includeCodeCheck: params.includeCodeCheck ?? true,
      codebaseRoot: params.codebaseRoot || process.cwd()
    });
    
    const firstContent = analysisResult.content[0];
    if (firstContent.type !== 'text') {
      throw new Error('Expected text content from analysis result');
    }
    const analysisReport = JSON.parse(firstContent.text);
    const triageItems = this.extractCurationItems(analysisReport.analyses);
    
    session = {
      sessionId: `curation-${Date.now()}`,
      createdAt: new Date().toISOString(),
      analysisResults: analysisReport.analyses,
      triageItems,
      triageState: {
        currentMode: 'delete', // Start with deletions - fastest decisions
        currentIndex: 0,
        history: []
      },
      actionQueues: {
        deletions: [],
        connections: [],
        enhancements: [],
        patterns: []
      }
    };
    
    this.saveSession(session);
    
    const summary = this.generateSessionSummary(session);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: "🎯 New Curation Session Started",
          sessionId: session.sessionId,
          summary,
          firstItem: this.getCurrentItem(session),
          commands: [
            "'y' = Queue for action",
            "'n' = Skip/reject", 
            "'s' = Skip for now",
            "'d' = Show details",
            "'mode <type>' = Switch mode",
            "'queue status' = Review queues"
          ]
        }, null, 2)
      }]
    };
  }

  /**
   * Move to next item in triage
   */
  private async nextItem(params: any): Promise<MCPResponse> {
    const session = this.loadSession();
    const action = params.action; // 'y', 'n', 's'
    
    if (action && session.triageState.currentItemId) {
      await this.processCurrentItemAction(session, action);
    }
    
    const nextItem = this.advanceToNextItem(session);
    this.saveSession(session);
    
    if (!nextItem) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: "✅ Triage Complete for Current Mode",
            mode: session.triageState.currentMode,
            suggestions: [
              "Switch modes: 'mode connect', 'mode enhance', 'mode all'",
              "Review queues: 'queue status'", 
              "Execute actions: 'execute'"
            ],
            queueSummary: this.getQueueSummary(session)
          }, null, 2)
        }]
      };
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          currentItem: this.formatItemForTriage(nextItem, session),
          progress: this.getTriageProgress(session),
          prompt: this.generateTriagePrompt(nextItem)
        }, null, 2)
      }]
    };
  }

  /**
   * Show detailed information about current item
   */
  private async showDetails(params: any): Promise<MCPResponse> {
    const session = this.loadSession();
    const currentItem = this.getCurrentItem(session);
    
    if (!currentItem) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: "No current item to show details for"
          }, null, 2)
        }]
      };
    }
    
    const details = await this.getItemDetails(currentItem, session);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(details, null, 2)
      }]
    };
  }

  /**
   * Extract curation items from multi-AI analysis
   */
  private extractCurationItems(analyses: MultiAIAnalysis[]): CurationItem[] {
    const items: CurationItem[] = [];
    let itemCounter = 1;
    
    for (const analysis of analyses) {
      // Deletion recommendations
      if (analysis.consensus.finalDecision) {
        items.push({
          itemId: `del-${itemCounter++}`,
          type: 'delete',
          status: 'pending',
          confidence: analysis.consensus.consensusConfidence,
          memoryId: analysis.memoryId,
          recommendation: `Delete memory (Quality: ${analysis.qualityScore}/100)`,
          agentFindings: analysis.agentAnalyses.map(a => a.reasoning),
          metadata: { 
            qualityScore: analysis.qualityScore,
            agreementLevel: analysis.consensus.agreementLevel
          }
        });
      }
      
      // Enhancement opportunities
      const enhancementFindings = analysis.issues.filter(i => i.type === 'enhancement');
      for (const finding of enhancementFindings) {
        items.push({
          itemId: `enh-${itemCounter++}`,
          type: 'enhance',
          status: 'pending',
          confidence: 0.8, // Enhancement opportunities are generally high confidence
          memoryId: analysis.memoryId,
          recommendation: finding.description,
          agentFindings: [finding.suggestion || 'No specific suggestion provided'],
          metadata: { 
            severity: finding.severity,
            type: finding.type
          }
        });
      }
      
      // Connection opportunities  
      const connectionFindings = analysis.issues.filter(i => i.type === 'connection');
      for (const finding of connectionFindings) {
        items.push({
          itemId: `con-${itemCounter++}`,
          type: 'connect',
          status: 'pending',
          confidence: 0.7,
          memoryId: analysis.memoryId,
          memoryIds: finding.relatedMemoryIds || [analysis.memoryId],
          recommendation: finding.description,
          agentFindings: [finding.suggestion || 'Cross-reference opportunity identified'],
          metadata: {
            severity: finding.severity,
            type: finding.type
          }
        });
      }
      
      // Pattern extraction opportunities
      const patternFindings = analysis.issues.filter(i => i.type === 'pattern');
      for (const finding of patternFindings) {
        items.push({
          itemId: `pat-${itemCounter++}`,
          type: 'extract-pattern',
          status: 'pending',
          confidence: 0.9,
          memoryId: analysis.memoryId,
          recommendation: finding.description,
          agentFindings: [finding.suggestion || 'Pattern extraction opportunity'],
          metadata: {
            severity: finding.severity,
            type: finding.type
          }
        });
      }
    }
    
    return items;
  }

  // Helper methods for session management, formatting, etc.
  private loadSession(): CurationSession {
    if (!fs.existsSync(this.sessionFile)) {
      throw new Error('No active curation session found. Run "start" first.');
    }
    return JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
  }
  
  private saveSession(session: CurationSession): void {
    fs.writeFileSync(this.sessionFile, JSON.stringify(session, null, 2));
  }
  
  private getCurrentItem(session: CurationSession): CurationItem | null {
    const filteredItems = this.getFilteredItems(session);
    return filteredItems[session.triageState.currentIndex] || null;
  }
  
  private getFilteredItems(session: CurationSession): CurationItem[] {
    const { currentMode } = session.triageState;
    
    if (currentMode === 'all') {
      return session.triageItems.filter(item => item.status === 'pending');
    }
    
    return session.triageItems.filter(item => 
      item.status === 'pending' && 
      (currentMode === 'delete' && item.type === 'delete' ||
       currentMode === 'connect' && item.type === 'connect' ||
       currentMode === 'enhance' && item.type === 'enhance' ||
       currentMode === 'extract-pattern' && item.type === 'extract-pattern')
    );
  }

  private generateSessionSummary(session: CurationSession) {
    const typeCounts = session.triageItems.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalItems: session.triageItems.length,
      byType: typeCounts,
      startingMode: session.triageState.currentMode
    };
  }

  private generateTriagePrompt(item: CurationItem): string {
    const typeEmoji = {
      'delete': '🗑️',
      'connect': '🔗', 
      'enhance': '✨',
      'extract-pattern': '📋'
    };
    
    return `${typeEmoji[item.type]} ${item.recommendation} (Confidence: ${Math.round(item.confidence * 100)}%) [y/n/s/d]`;
  }

  private formatItemForTriage(item: CurationItem, session: CurationSession) {
    return {
      itemId: item.itemId,
      type: item.type,
      confidence: Math.round(item.confidence * 100),
      recommendation: item.recommendation,
      memoryId: item.memoryId,
      memoryIds: item.memoryIds
    };
  }

  private getTriageProgress(session: CurationSession): any {
    const filtered = this.getFilteredItems(session);
    const total = session.triageItems.filter(item => {
      const { currentMode } = session.triageState;
      if (currentMode === 'all') return true;
      return item.type === currentMode;
    }).length;
    
    return {
      current: session.triageState.currentIndex + 1,
      total,
      mode: session.triageState.currentMode
    };
  }

  private getQueueSummary(session: CurationSession) {
    return {
      deletions: session.actionQueues.deletions.length,
      connections: session.actionQueues.connections.length, 
      enhancements: session.actionQueues.enhancements.length,
      patterns: session.actionQueues.patterns.length
    };
  }

  /**
   * Process user action on current item (y/n/s)
   */
  private async processCurrentItemAction(session: CurationSession, action: string): Promise<void> {
    const currentItem = this.getCurrentItem(session);
    if (!currentItem) return;
    
    switch (action.toLowerCase()) {
      case 'y':
        // Queue the item for action
        currentItem.status = 'queued';
        this.addToActionQueue(session, currentItem);
        break;
      case 'n':
        // Reject the recommendation
        currentItem.status = 'rejected';
        break;
      case 's':
        // Skip for now (keep as pending but advance)
        currentItem.status = 'skipped';
        break;
    }
    
    // Add to history for potential 'back' functionality
    session.triageState.history.push(currentItem.itemId);
  }

  /**
   * Advance to next pending item in current mode
   */
  private advanceToNextItem(session: CurationSession): CurationItem | null {
    const filteredItems = this.getFilteredItems(session);
    session.triageState.currentIndex++;
    
    // Find next pending item
    while (session.triageState.currentIndex < filteredItems.length) {
      const item = filteredItems[session.triageState.currentIndex];
      if (item.status === 'pending') {
        session.triageState.currentItemId = item.itemId;
        return item;
      }
      session.triageState.currentIndex++;
    }
    
    // No more items in current mode
    session.triageState.currentItemId = undefined;
    return null;
  }

  /**
   * Get detailed information about an item
   */
  private async getItemDetails(item: CurationItem, session: CurationSession): Promise<any> {
    const memory = item.memoryId ? await this.dbService.getMemory(item.memoryId) : null;
    const relatedMemories = [];
    
    if (item.memoryIds) {
      for (const id of item.memoryIds) {
        const mem = await this.dbService.getMemory(id);
        if (mem) relatedMemories.push({
          id: mem.memory_id,
          preview: mem.content.substring(0, 100) + '...',
          type: mem.content_type
        });
      }
    }
    
    return {
      title: `DETAILS FOR: ${item.type.toUpperCase()} ${item.itemId}`,
      recommendation: item.recommendation,
      confidence: `${Math.round(item.confidence * 100)}%`,
      agentFindings: item.agentFindings,
      memory: memory ? {
        id: memory.memory_id,
        preview: memory.content.substring(0, 200) + '...',
        type: memory.content_type,
        created: memory.created_at
      } : null,
      relatedMemories,
      metadata: item.metadata,
      prompt: `Proceed with this ${item.type}? (y/n/s)`
    };
  }

  /**
   * Manage action queues
   */
  private async manageQueue(params: any): Promise<MCPResponse> {
    const session = this.loadSession();
    const subCommand = params.subCommand || 'status';
    
    switch (subCommand) {
      case 'status':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              title: "📋 Action Queue Status",
              queues: this.getDetailedQueueStatus(session),
              commands: [
                "'queue view <type>' - List items in queue",
                "'queue clear <type>' - Clear specific queue", 
                "'queue unqueue <itemId>' - Remove specific item",
                "'execute' - Process all queues"
              ]
            }, null, 2)
          }]
        };
        
      case 'view':
        const queueType = params.queueType;
        return this.viewQueue(session, queueType);
        
      case 'clear':
        const clearType = params.clearType;
        return this.clearQueue(session, clearType);
        
      case 'unqueue':
        const itemId = params.itemId;
        return this.unqueueItem(session, itemId);
        
      default:
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: `Unknown queue command: ${subCommand}`,
              availableCommands: ['status', 'view', 'clear', 'unqueue']
            }, null, 2)
          }]
        };
    }
  }

  /**
   * Show overall session status
   */
  private async showStatus(): Promise<MCPResponse> {
    const session = this.loadSession();
    
    const statusByType = session.triageItems.reduce((acc, item) => {
      if (!acc[item.type]) {
        acc[item.type] = { pending: 0, queued: 0, skipped: 0, rejected: 0 };
      }
      acc[item.type][item.status]++;
      return acc;
    }, {} as Record<string, Record<string, number>>);
    
    const queueSummary = this.getQueueSummary(session);
    const progress = this.getTriageProgress(session);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          title: "📊 Curation Session Status",
          sessionId: session.sessionId,
          currentMode: session.triageState.currentMode,
          progress,
          statusByType,
          actionQueues: queueSummary,
          suggestions: this.getStatusSuggestions(session)
        }, null, 2)
      }]
    };
  }

  /**
   * Switch triage mode
   */
  private async switchMode(params: any): Promise<MCPResponse> {
    const session = this.loadSession();
    const newMode = params.mode as CurationSession['triageState']['currentMode'];
    
    if (!['all', 'delete', 'connect', 'enhance', 'extract-pattern'].includes(newMode)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Invalid mode: ${newMode}`,
            availableModes: ['all', 'delete', 'connect', 'enhance', 'extract-pattern']
          }, null, 2)
        }]
      };
    }
    
    session.triageState.currentMode = newMode;
    session.triageState.currentIndex = 0;
    
    const nextItem = this.advanceToNextItem(session);
    this.saveSession(session);
    
    const modeStats = this.getModeStats(session, newMode);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `🔄 Switched to ${newMode.toUpperCase()} mode`,
          modeStats,
          currentItem: nextItem ? this.formatItemForTriage(nextItem, session) : null,
          prompt: nextItem ? this.generateTriagePrompt(nextItem) : "No items in this mode"
        }, null, 2)
      }]
    };
  }

  /**
   * Execute all queued actions with confirmation
   */
  private async executeQueues(params: any): Promise<MCPResponse> {
    const session = this.loadSession();
    const confirm = params.confirm === true;
    
    const queueSummary = this.getQueueSummary(session);
    const totalActions = Object.values(queueSummary).reduce((sum, count) => sum + count, 0);
    
    if (totalActions === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: "No actions queued for execution"
          }, null, 2)
        }]
      };
    }
    
    if (!confirm) {
      // Show confirmation prompt
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            title: "⚠️  EXECUTION CONFIRMATION",
            warning: "This will permanently modify your memory collection",
            plannedActions: {
              deletions: this.getQueuedItems(session, 'deletions').map(item => ({
                id: item.itemId,
                memory: item.memoryId,
                reason: item.recommendation
              })),
              enhancements: queueSummary.enhancements,
              connections: queueSummary.connections,
              patterns: queueSummary.patterns
            },
            summary: queueSummary,
            confirmation: "Run 'execute confirm=true' to proceed"
          }, null, 2)
        }]
      };
    }
    
    // Execute the actions
    const results = await this.executeAllQueuedActions(session);
    
    // Clean up session file
    fs.unlinkSync(this.sessionFile);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          title: "✅ Execution Complete",
          results,
          message: "Curation session completed and cleaned up"
        }, null, 2)
      }]
    };
  }

  // Additional helper methods
  
  private addToActionQueue(session: CurationSession, item: CurationItem): void {
    switch (item.type) {
      case 'delete':
        session.actionQueues.deletions.push(item.itemId);
        break;
      case 'connect':
        session.actionQueues.connections.push(item.itemId);
        break;
      case 'enhance':
        session.actionQueues.enhancements.push(item.itemId);
        break;
      case 'extract-pattern':
        session.actionQueues.patterns.push(item.itemId);
        break;
    }
  }

  private getDetailedQueueStatus(session: CurationSession) {
    return {
      deletions: {
        count: session.actionQueues.deletions.length,
        items: this.getQueuedItems(session, 'deletions').map(item => ({
          id: item.itemId,
          memory: item.memoryId,
          reason: item.recommendation
        }))
      },
      connections: {
        count: session.actionQueues.connections.length,
        items: this.getQueuedItems(session, 'connections').map(item => ({
          id: item.itemId,
          memories: item.memoryIds,
          reason: item.recommendation
        }))
      },
      enhancements: {
        count: session.actionQueues.enhancements.length
      },
      patterns: {
        count: session.actionQueues.patterns.length
      }
    };
  }

  private getQueuedItems(session: CurationSession, queueType: keyof CurationSession['actionQueues']): CurationItem[] {
    const itemIds = session.actionQueues[queueType];
    return session.triageItems.filter(item => itemIds.includes(item.itemId));
  }

  private viewQueue(session: CurationSession, queueType: string): MCPResponse {
    const items = this.getQueuedItems(session, queueType as keyof CurationSession['actionQueues']);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          title: `📋 ${queueType.toUpperCase()} Queue`,
          count: items.length,
          items: items.map(item => ({
            id: item.itemId,
            recommendation: item.recommendation,
            confidence: Math.round(item.confidence * 100)
          }))
        }, null, 2)
      }]
    };
  }

  private clearQueue(session: CurationSession, queueType: string): MCPResponse {
    const key = queueType as keyof CurationSession['actionQueues'];
    const count = session.actionQueues[key].length;
    
    // Reset items to pending
    const clearedItems = this.getQueuedItems(session, key);
    clearedItems.forEach(item => {
      item.status = 'pending';
    });
    
    session.actionQueues[key] = [];
    this.saveSession(session);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `🧹 Cleared ${count} items from ${queueType} queue`,
          itemsResetToPending: count
        }, null, 2)
      }]
    };
  }

  private unqueueItem(session: CurationSession, itemId: string): MCPResponse {
    const item = session.triageItems.find(i => i.itemId === itemId);
    
    if (!item) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Item ${itemId} not found`
          }, null, 2)
        }]
      };
    }
    
    // Remove from appropriate queue
    Object.keys(session.actionQueues).forEach(queueType => {
      const queue = session.actionQueues[queueType as keyof CurationSession['actionQueues']];
      const index = queue.indexOf(itemId);
      if (index > -1) {
        queue.splice(index, 1);
        item.status = 'pending';
      }
    });
    
    this.saveSession(session);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `✅ Removed ${itemId} from queue`,
          itemStatus: 'pending'
        }, null, 2)
      }]
    };
  }

  private getModeStats(session: CurationSession, mode: string) {
    const items = session.triageItems.filter(item => 
      mode === 'all' || item.type === mode
    );
    
    return {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      queued: items.filter(i => i.status === 'queued').length,
      skipped: items.filter(i => i.status === 'skipped').length,
      rejected: items.filter(i => i.status === 'rejected').length
    };
  }

  private getStatusSuggestions(session: CurationSession): string[] {
    const suggestions = [];
    const queueSummary = this.getQueueSummary(session);
    const totalQueued = Object.values(queueSummary).reduce((sum, count) => sum + count, 0);
    
    if (totalQueued > 0) {
      suggestions.push(`Execute ${totalQueued} queued actions with 'execute'`);
    }
    
    const pendingByMode = {
      delete: this.getModeStats(session, 'delete').pending,
      connect: this.getModeStats(session, 'connect').pending,
      enhance: this.getModeStats(session, 'enhance').pending,
      'extract-pattern': this.getModeStats(session, 'extract-pattern').pending
    };
    
    const modesWithPending = Object.entries(pendingByMode)
      .filter(([mode, count]) => count > 0)
      .sort(([,a], [,b]) => b - a);
    
    if (modesWithPending.length > 0) {
      suggestions.push(`Continue triage in ${modesWithPending[0][0]} mode (${modesWithPending[0][1]} items)`);
    }
    
    return suggestions;
  }

  private async executeAllQueuedActions(session: CurationSession): Promise<any> {
    const results = {
      deletions: 0,
      connections: 0,
      enhancements: 0,
      patterns: 0,
      errors: [] as string[]
    };
    
    // Execute deletions
    for (const itemId of session.actionQueues.deletions) {
      const item = session.triageItems.find(i => i.itemId === itemId);
      if (item?.memoryId) {
        try {
          await this.dbService.deleteMemory(item.memoryId);
          results.deletions++;
        } catch (error) {
          results.errors.push(`Failed to delete ${item.memoryId}: ${error}`);
        }
      }
    }
    
    // Note: In a full implementation, you would also execute:
    // - Connection creation between memories
    // - Memory enhancement (adding content, examples, etc.)
    // - Pattern extraction (creating templates from successful implementations)
    
    return results;
  }

  private async showHelp(): Promise<MCPResponse> {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          title: "Interactive Memory Curator",
          commands: {
            "start": "Begin new curation session or resume existing",
            "next [y/n/s]": "Process current item and advance (y=queue, n=reject, s=skip)",
            "details": "Show detailed info about current item", 
            "mode <type>": "Switch triage mode (delete|connect|enhance|extract-pattern|all)",
            "queue status": "Show summary of queued actions",
            "queue view <type>": "List items in specific queue",
            "execute": "Execute all queued actions (with confirmation)",
            "status": "Show overall session progress"
          }
        }, null, 2)
      }]
    };
  }
}