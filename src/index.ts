import { config } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DatabaseService, MemoryType } from './db/service.js';
import { createDatabaseAdapter, createDatabaseAdapterToml, getConfigSummary } from './config.js';
import { getConfigSummaryToml } from './config-toml.js';
import { storeDevProgress, storeInitialProgress } from './dev-memory.js';
import { formatHashForDisplay, parseHexToHash, isValidHashId } from './utils/hash.js';
import { createErrorResponse } from './utils/error-response.js';
import { buildInfo } from './buildInfo.js';
import { MemoryOverviewTool } from './tools/memory-overview.js';
import { StoreDevMemoryTool } from './tools/store-dev-memory.js';
import { QuickStoreTool } from './tools/quick-store.js';
import { GetRecentContextTool } from './tools/get-recent-context.js';
import { ListDevMemoriesTool } from './tools/list-dev-memories.js';
import { GetDevMemoryTool } from './tools/get-dev-memory.js';
import { SearchTool } from './tools/search.js';
import { SearchEnhancedTool } from './tools/search-enhanced.js';
import { GetAllTagsTool } from './tools/get-all-tags.js';
import { ListMemoriesByTagTool } from './tools/list-memories-by-tag.js';
import { AnalyzeMemoryQualityTool } from './tools/analyze-memory-quality.js';
import { MultiAIAnalyzeMemoryQualityTool } from './tools/multi-ai-analyze-memory-quality.js';
import { InteractiveCuratorTool } from './tools/interactive-curator.js';
import { SyncDocsTool } from './tools/sync-docs.js';

// Auto-detection utility for memory types
function detectMemoryType(content: string): MemoryType {
    const lowerContent = content.toLowerCase();
    
    // Code detection patterns
    const codePatterns = [
        /\b(function|class|interface|type|const|let|var|import|export|return)\s+/,
        /\b(async|await|promise|callback)\b/,
        /\.(js|ts|tsx|jsx|py|java|cpp|c|go|rs|php|rb|swift|kt)(\s|$)/,
        /```[\w]*\n/,  // Code blocks
        /^\s*(\/\/|\/\*|\#|<!--)/m,  // Comments
        /\b(git|npm|yarn|pip|cargo|maven|gradle)\s+/,
        /\bfix|bug|error|exception|debug|test|implement|refactor\b/
    ];
    
    // Decision detection patterns  
    const decisionPatterns = [
        /\b(decided|chose|selected|picked|opted|determined)\b/,
        /\b(decision|choice|option|alternative|approach)\b/,
        /\b(will use|going with|settling on|adopting)\b/,
        /\b(instead of|rather than|over|versus|vs\.)\b/,
        /\b(pros and cons|trade.?off|benefit|drawback)\b/
    ];
    
    // Reference detection patterns
    const referencePatterns = [
        /https?:\/\/[^\s]+/,
        /\b(documentation|docs|readme|wiki|manual|guide)\b/,
        /\b(reference|link|url|source|article|blog|post)\b/,
        /\b(see also|refer to|check out|look at)\b/,
        /\b(api|sdk|library|framework|package|module)\s+(docs?|documentation)/
    ];
    
    // Count pattern matches
    const codeScore = codePatterns.reduce((score, pattern) => score + (pattern.test(content) ? 1 : 0), 0);
    const decisionScore = decisionPatterns.reduce((score, pattern) => score + (pattern.test(lowerContent) ? 1 : 0), 0);
    const referenceScore = referencePatterns.reduce((score, pattern) => score + (pattern.test(lowerContent) ? 1 : 0), 0);
    
    // Determine type based on highest score
    if (codeScore >= decisionScore && codeScore >= referenceScore && codeScore > 0) {
        return 'code';
    } else if (decisionScore >= referenceScore && decisionScore > 0) {
        return 'decision';
    } else if (referenceScore > 0) {
        return 'reference';
    }
    
    // Default to conversation
    return 'conversation';
}

// Generate smart tags based on content
async function generateSmartTags(content: string, type: MemoryType): Promise<string[]> {
    const tags: string[] = [];
    const lowerContent = content.toLowerCase();
    
    // Add type-based tag
    tags.push(type);
    
    // Technology tags
    const techPatterns = {
        'typescript': /\b(typescript|\.ts|\.tsx)\b/,
        'javascript': /\b(javascript|\.js|\.jsx|node\.js)\b/,
        'react': /\b(react|jsx|component|hook|useState|useEffect)\b/,
        'database': /\b(database|db|sql|postgres|sqlite|query|table)\b/,
        'api': /\b(api|endpoint|rest|graphql|http|request|response)\b/,
        'testing': /\b(test|spec|jest|mocha|cypress|unit test|integration)\b/,
        'git': /\b(git|commit|branch|merge|pull request|pr)\b/,
        'docker': /\b(docker|container|dockerfile|image)\b/,
        'mcp': /\b(mcp|model context protocol|tool|server)\b/
    };
    
    // Status/action tags
    const actionPatterns = {
        'bugfix': /\b(fix|bug|error|issue|problem|broken)\b/,
        'feature': /\b(new feature|add|implement|create|build)\b/,
        'refactor': /\b(refactor|cleanup|reorganize|improve)\b/,
        'performance': /\b(performance|optimize|speed|slow|fast)\b/,
        'security': /\b(security|auth|permission|vulnerability)\b/,
        'documentation': /\b(document|readme|comment|explain)\b/
    };
    
    // Add matching tech tags
    for (const [tag, pattern] of Object.entries(techPatterns)) {
        if (pattern.test(lowerContent)) {
            tags.push(tag);
        }
    }
    
    // Add matching action tags  
    for (const [tag, pattern] of Object.entries(actionPatterns)) {
        if (pattern.test(lowerContent)) {
            tags.push(tag);
        }
    }
    
    // Filter out invalid tag names before returning
    const { isValidTagName } = await import('./utils/hash.js');
    const validTags = tags.filter(tag => isValidTagName(tag));
    
    // Limit to most relevant tags
    return [...new Set(validTags)].slice(0, 6);
}

// Load environment variables
config();

// Initialize database adapter based on TOML configuration
console.error(`🚀 Starting Memory MCP Server`);
console.error(`📊 Configuration loaded`);
console.error(`📋 ${getConfigSummaryToml()}`);

const adapter = await createDatabaseAdapterToml();
const dbService = new DatabaseService(adapter);
await dbService.initialize();

// Store initial development progress (skip if we already have memories)
const existingMemories = await dbService.getDevMemories();
if (existingMemories.length === 0) {
  console.error('📝 Storing initial development progress...');
  await storeInitialProgress(dbService);
} else {
  console.error(`📚 Found ${existingMemories.length} existing memories - skipping initial setup`);
}

// Create MCP Server with proper initialization
const server = new McpServer({
    name: 'agent-memory',
    version: '1.0.0',
    capabilities: {
        tools: {
            'memory-overview': true,
            'store-dev-memory': true,
            'quick-store': true,
            'get-recent-context': true,
            'list-dev-memories': true,
            'get-dev-memory': true,
            'search': true,
            'search-enhanced': true,
            'get-all-tags': true,
            'list-memories-by-tag': true,
            'analyze-memory-quality': true,
            'multi-ai-analyze-memory-quality': true
        }
    }
});

// Initialize tools
const memoryOverviewTool = new MemoryOverviewTool(dbService);
const storeDevMemoryTool = new StoreDevMemoryTool(dbService, storeMemoryWithTags);
const quickStoreTool = new QuickStoreTool(dbService, storeMemoryWithTags, detectMemoryType, generateSmartTags);
const getRecentContextTool = new GetRecentContextTool(dbService);
const listDevMemoriesTool = new ListDevMemoriesTool(dbService);
const getDevMemoryTool = new GetDevMemoryTool(dbService, parseHexToHash, isValidHashId, formatHashForDisplay);
const searchTool = new SearchTool(dbService, formatHashForDisplay);
const searchEnhancedTool = new SearchEnhancedTool(dbService, formatHashForDisplay);
const getAllTagsTool = new GetAllTagsTool(dbService);
const listMemoriesByTagTool = new ListMemoriesByTagTool(dbService, formatHashForDisplay);
const analyzeMemoryQualityTool = new AnalyzeMemoryQualityTool(dbService);
const multiAIAnalyzeMemoryQualityTool = new MultiAIAnalyzeMemoryQualityTool(dbService, true);
const interactiveCuratorTool = new InteractiveCuratorTool(dbService);
const syncDocsTool = new SyncDocsTool(dbService);

// Add comprehensive overview tool - the go-to starting point for new Claude sessions
server.tool(
    'memory-overview',
    'Get a comprehensive overview of the memory system: recent memories, capabilities, statistics, and usage examples. Start here!',
    {},
    async () => {
        return memoryOverviewTool.handle();
    }
);

// Add tool to store development progress (uses shared storage function)
server.tool(
    'store-dev-memory',
    'Store a new development memory with content, decisions, and code changes. Supports semantic search via pgvector.',
    {
        content: z.string().describe('The main content of the memory - what you want to remember'),
        type: z.enum(['conversation', 'code', 'decision', 'reference']).describe('Type: conversation (discussions), code (implementation), decision (choices made), reference (documentation)'),
        keyDecisions: z.array(z.string()).optional().describe('Important decisions made during this work'),
        status: z.string().optional().describe('Current implementation status (e.g., "completed", "in-progress", "blocked")'),
        codeChanges: z.array(z.string()).optional().describe('List of code changes or files modified'),
        filesCreated: z.array(z.string()).optional().describe('New files created or existing files modified'),
        tags: z.array(z.string()).optional().describe('Tags for categorization and filtering')
    },
    async (params) => {
        return storeDevMemoryTool.handle(params);
    }
);

// Shared memory storage function to avoid duplication
async function storeMemoryWithTags(
    content: string, 
    type: MemoryType, 
    metadata: any, 
    tags?: string[]
): Promise<string> {
    const memoryId = await storeDevProgress(dbService, content, type, metadata);
    
    if (tags && tags.length > 0) {
        await dbService.addMemoryTags(memoryId, tags);
    }
    
    return memoryId;
}

// Add quick-store tool with auto-detection (wraps shared storage logic)
server.tool(
    'quick-store',
    'Store a memory with automatic type detection and smart tagging. Just provide content - the system will detect type and generate relevant tags.',
    {
        content: z.string().describe('The content to store - type and tags will be auto-detected'),
        type: z.enum(['conversation', 'code', 'decision', 'reference']).optional().describe('Override auto-detected memory type'),
        status: z.string().optional().describe('Implementation status (e.g., "completed", "in-progress", "blocked")'),
        tags: z.array(z.string()).optional().describe('Additional tags to include beyond auto-generated ones')
    },
    async (params) => {
        return quickStoreTool.handle(params);
    }
);

// Add get-recent-context tool for ongoing work sessions
server.tool(
    'get-recent-context',
    'Get recent memories to understand current work context. Filters by date range, types, and includes metadata for session continuity.',
    {
        limit: z.number().optional().default(5).describe('Number of recent memories to retrieve (default: 5)'),
        since: z.string().optional().describe('ISO date string - only get memories created after this date'),
        types: z.array(z.enum(['conversation', 'code', 'decision', 'reference'])).optional().describe('Filter by specific memory types'),
        includeTags: z.boolean().optional().default(true).describe('Include tags in the response (default: true)'),
        format: z.enum(['full', 'summary', 'context']).optional().default('context').describe('Response format: full (all data), summary (brief), context (optimized for session continuity)')
    },
    async (params) => {
        return getRecentContextTool.handle(params);
    }
);

// Add tool to list development memories
server.tool(
    'list-dev-memories',
    'List recent development memories with efficient pagination. Use limit parameter to control results.',
    {
        limit: z.number().optional().describe('Maximum number of memories to return (default: 10, helps with performance)'),
        tag: z.string().optional().describe('Filter by tag (TODO: not yet implemented)')
    },
    async (params) => {
        return listDevMemoriesTool.handle(params);
    }
);

// Add tool to get specific memory
server.tool(
    'get-dev-memory',
    'Retrieve a specific development memory by its hash ID. IDs are shown in hex format (e.g., a1b2c3d4e5f67890).',
    {
        memoryId: z.string().describe('Hash ID of the memory to retrieve (hex format like a1b2c3d4e5f67890)')
    },
    async (params) => {
        return getDevMemoryTool.handle(params);
    }
);

// Add tool for semantic search
server.tool(
    'search',
    'Find similar memories using AI-powered semantic search (pgvector). Returns results ranked by similarity.',
    {
        searchTerm: z.string().describe('Text to search for - finds semantically similar memories using AI embeddings')
    },
    async (params) => {
        return searchTool.handle(params);
    }
);

// Add enhanced search tool with advanced filtering and ranking
server.tool(
    'search-enhanced',
    'Advanced semantic search with filtering, ranking, and detailed results. Includes similarity scores, date filtering, and type-based search.',
    {
        query: z.string().describe('Text to search for - finds semantically similar memories'),
        limit: z.number().optional().default(5).describe('Maximum number of results (default: 5)'),
        minSimilarity: z.number().optional().default(0.1).describe('Minimum similarity threshold 0.0-1.0 (default: 0.1)'),
        types: z.array(z.enum(['conversation', 'code', 'decision', 'reference'])).optional().describe('Filter by specific memory types'),
        dateRange: z.object({
            from: z.string().describe('Start date (ISO format)'),
            to: z.string().describe('End date (ISO format)')
        }).optional().describe('Filter by creation date range'),
        showScores: z.boolean().optional().default(true).describe('Include similarity scores in results (default: true)'),
        includeTags: z.boolean().optional().default(true).describe('Include tags in results (default: true)'),
        sortBy: z.enum(['similarity', 'date', 'type']).optional().default('similarity').describe('Sort results by similarity, date, or type')
    },
    async (params) => {
        return searchEnhancedTool.handle(params);
    }
);

// Add tool to get all available tags
server.tool(
    'get-all-tags',
    'Get all available tags in the memory system for browsing and discovery.',
    {},
    async () => {
        return getAllTagsTool.handle();
    }
);

// Add tool to list memories by tag
server.tool(
    'list-memories-by-tag',
    'Get all memories that have a specific tag for targeted browsing.',
    {
        tagName: z.string().describe('Name of the tag to filter memories by'),
        limit: z.number().optional().describe('Maximum number of memories to return (default: 10)')
    },
    async (params) => {
        return listMemoriesByTagTool.handle(params);
    }
);

// Add memory quality analyzer tool
server.tool(
    'analyze-memory-quality',
    'Analyze memory quality by detecting outdated code references, broken file paths, duplicates, and inconsistent information. Provides quality scores and actionable recommendations.',
    {
        memoryId: z.string().optional().describe('Analyze specific memory by ID'),
        projectId: z.string().optional().describe('Analyze all memories in project'),
        codebaseRoot: z.string().optional().describe('Path to codebase for reality checking'),
        includeCodeCheck: z.boolean().optional().default(true).describe('Whether to check against current code'),
        limit: z.number().optional().default(50).describe('Max memories to analyze')
    },
    async (params) => {
        return analyzeMemoryQualityTool.handle(params);
    }
);

// Add multi-AI memory quality analyzer tool
server.tool(
    'multi-ai-analyze-memory-quality',
    'EXPERIMENTAL: Analyze memory quality using multiple specialized AI agents with consensus-based decision making. Provides enhanced pattern recognition, consensus confidence scoring, and multi-perspective analysis.',
    {
        memoryId: z.string().optional().describe('Analyze specific memory by ID'),
        projectId: z.string().optional().describe('Analyze all memories in project'),
        codebaseRoot: z.string().optional().describe('Path to codebase for reality checking'),
        includeCodeCheck: z.boolean().optional().default(true).describe('Whether to check against current code'),
        limit: z.number().optional().default(50).describe('Max memories to analyze')
    },
    async (params) => {
        return multiAIAnalyzeMemoryQualityTool.handle(params);
    }
);

// Add interactive memory curator for triage-based memory management
server.tool(
    'interactive-curator',
    'Interactive memory curation system with triage workflow for handling multi-AI analysis recommendations. Uses session-based state management for efficient decision-making and batch actions.',
    {
        command: z.enum(['start', 'next', 'details', 'queue', 'status', 'mode', 'execute']).describe('Command to execute'),
        action: z.enum(['y', 'n', 's']).optional().describe('Triage action: y=queue, n=reject, s=skip'),
        mode: z.enum(['all', 'delete', 'connect', 'enhance', 'extract-pattern']).optional().describe('Triage mode to switch to'),
        sessionFile: z.string().optional().describe('Path to session file (default: .curation_session.json)'),
        limit: z.number().optional().default(50).describe('Number of memories to analyze'),
        includeCodeCheck: z.boolean().optional().default(true).describe('Include code reality checking'),
        codebaseRoot: z.string().optional().describe('Path to codebase root'),
        subCommand: z.enum(['status', 'view', 'clear', 'unqueue']).optional().describe('Queue management sub-command'),
        queueType: z.enum(['deletions', 'connections', 'enhancements', 'patterns']).optional().describe('Queue type for view/clear operations'),
        itemId: z.string().optional().describe('Item ID for unqueue operation'),
        confirm: z.boolean().optional().describe('Confirmation flag for execution')
    },
    async (params) => {
        return interactiveCuratorTool.handle(params);
    }
);

// Add sync-docs tool for ingesting markdown documentation
server.tool(
    'sync-docs',
    'Sync markdown documentation from ~/docs and project docs/ directories to lessons_learned_docs table. Detects new and updated files using content hashing.',
    {
        directories: z.array(z.string()).optional().describe('Directories to scan for *.md files (default: ~/docs and $PWD/docs)'),
        forceUpdate: z.boolean().optional().default(false).describe('Re-ingest all files even if unchanged (default: false)')
    },
    async (params) => {
        return syncDocsTool.handle(params);
    }
);

// Initialize server transport
const transport = new StdioServerTransport();
server.connect(transport);

console.error('Memory MCP Server started'); 