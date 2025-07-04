// TDD Phase 2: Memory Overview Tool (GREEN phase implementation)
// Author: PB and Claude
// Date: 2025-07-04

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { formatHashForDisplay } from '../utils/hash.js';
import { buildInfo } from '../buildInfo.js';
import { getConfigurationInfo } from '../config-toml.js';
import { checkOllamaHealth } from '../embeddings.js';

export class MemoryOverviewTool extends BaseMCPTool {
  async handle(): Promise<MCPResponse> {
    try {
      // Get basic statistics
      const recentMemories = await this.dbService.getDevMemories(5);
      const totalMemories = await this.dbService.getDevMemories(); // Get total count
      
      // Get real-time diagnostic information
      const [databaseInfo, configInfo, ollamaHealth] = await Promise.all([
        this.dbService.getDatabaseInfo(),
        Promise.resolve(getConfigurationInfo()),
        checkOllamaHealth()
      ]);
      
      // Build comprehensive overview with real diagnostics
      const overview = {
        "🧠 Memory System Overview": {
          "total_memories": totalMemories.length,
          "id_system": "Hash-based IDs (64-bit) for distributed uniqueness"
        },
        
        "🔗 Database Connection (LIVE)": {
          "type": databaseInfo.type,
          "host": databaseInfo.host,
          "port": databaseInfo.port,
          "database": databaseInfo.database,
          "status": databaseInfo.isConnected ? "🟢 Connected" : "🔴 Disconnected",
          "postgres_version": databaseInfo.postgresVersion,
          "pgvector_version": databaseInfo.pgvectorVersion,
          "connection_pool": databaseInfo.connectionPool ? {
            "total": databaseInfo.connectionPool.totalConnections,
            "active": databaseInfo.connectionPool.activeConnections,
            "idle": databaseInfo.connectionPool.idleConnections,
            "waiting": databaseInfo.connectionPool.waitingClients
          } : null,
          "last_check": databaseInfo.lastHealthCheck
        },
        
        "⚙️ Configuration": {
          "source": configInfo.source,
          "config_file": configInfo.configPath || "N/A",
          "env_overrides": configInfo.overrides.length > 0 ? configInfo.overrides : "None"
        },
        
        "🤖 Ollama Service": {
          "status": ollamaHealth.connected ? "🟢 Connected" : "🔴 Disconnected",
          "host": ollamaHealth.host,
          "model": ollamaHealth.model,
          "last_test": ollamaHealth.lastEmbeddingTest || "Never",
          "error": ollamaHealth.error || "None"
        },
        
        "🔧 Build Info": {
          "built_at": buildInfo.timestamp,
          "version": buildInfo.version,
          "git_commit": buildInfo.gitCommit,
          "git_branch": buildInfo.gitBranch,
          "node_version": buildInfo.nodeVersion
        },
        
        "🛠️ Available Tools": {
          "memory-overview": "📊 This tool - comprehensive system overview",
          "search": "🔍 Basic semantic search using vector embeddings",
          "search-enhanced": "🎯 Advanced search with filtering, scoring, and date ranges",
          "store-dev-memory": "💾 Store detailed memories with metadata and tags",
          "quick-store": "⚡ Store memories with auto-detection of type and smart tagging",
          "get-recent-context": "🕒 Get recent memories for ongoing work context",
          "list-dev-memories": "📋 List recent memories with pagination",
          "get-dev-memory": "🎯 Retrieve specific memory by hash ID",
          "get-all-tags": "🏷️ Browse available tags for discovery",
          "list-memories-by-tag": "📂 Find memories by specific tags"
        },
        
        "🔍 Quick Start Examples": {
          "search_for_bugs": `search with "bug fixes" or "error handling"`,
          "search_for_features": `search with "new feature" or "implementation"`,
          "advanced_search": `search-enhanced with filtering by type, date range, and similarity`,
          "get_recent": `get-recent-context with limit=5 for current work session`,
          "store_progress": `store-dev-memory with type="code" for implementations`,
          "quick_store": `quick-store with just content - auto-detects type and tags`
        },
        
        "📊 Memory Types Available": {
          "conversation": "Discussions, decisions, planning sessions",
          "code": "Implementation details, technical solutions",
          "decision": "Important choices and their rationale",
          "reference": "Documentation, links, external resources"
        },
        
        "🏷️ Recent Memories Preview": recentMemories.map(memory => {
          const metadata = typeof memory.metadata === 'string' 
            ? JSON.parse(memory.metadata) 
            : memory.metadata;
          return {
            id: formatHashForDisplay(memory.memory_id),
            type: memory.content_type,
            preview: memory.content.substring(0, 100) + (memory.content.length > 100 ? '...' : ''),
            status: metadata?.implementation_status || 'N/A',
            created: memory.created_at
          };
        }),
        
        "💡 Pro Tips": [
          "Use 'search' first to find relevant existing memories",
          "Hash IDs are shown in hex format - copy/paste them exactly",
          "The 'limit' parameter in list-dev-memories improves performance",
          "All memories are searchable via AI semantic similarity",
          "Tag support is available for better organization"
        ]
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(overview, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'memory-overview');
    }
  }
}