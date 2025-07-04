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
            'list-memories-by-tag': true
        }
    }
});

// Initialize tools
const memoryOverviewTool = new MemoryOverviewTool(dbService);
const storeDevMemoryTool = new StoreDevMemoryTool(dbService, storeMemoryWithTags);

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
    async ({ content, type, status, tags = [] }) => {
        try {
            // Auto-detect memory type if not provided
            const detectedType = type || detectMemoryType(content);
            
            // Generate smart tags
            const autoTags = await generateSmartTags(content, detectedType);
            
            // Combine auto-generated tags with user-provided ones
            const allTags = [...new Set([...autoTags, ...tags])];
            
            // Extract key decisions if this appears to be a decision
            let keyDecisions: string[] | undefined;
            if (detectedType === 'decision') {
                const decisionMatches = content.match(/(?:decided|chose|selected|picked|opted)\s+[^.!?]*[.!?]/gi);
                keyDecisions = decisionMatches?.map(d => d.trim()) || undefined;
            }
            
            // Use shared storage function
            const memoryId = await storeMemoryWithTags(content, detectedType, {
                implementation_status: status,
                key_decisions: keyDecisions,
                date: new Date().toISOString()
            }, allTags);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        memoryId: formatHashForDisplay(memoryId),
                        detectedType: detectedType,
                        autoDetected: !type,
                        tags: allTags,
                        autoGeneratedTags: autoTags.length,
                        keyDecisions: keyDecisions
                    }, null, 2)
                }]
            };
        } catch (error) {
            return createErrorResponse(error, 'quick-store');
        }
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
    async ({ limit = 5, since, types, includeTags = true, format = 'context' }) => {
        try {
            // Get recent memories with efficient pagination
            let memories = await dbService.getDevMemories(limit * 2); // Get extra to allow for filtering
            
            // Apply date filter if provided
            if (since) {
                const sinceDate = new Date(since);
                if (isNaN(sinceDate.getTime())) {
                    return {
                        isError: true,
                        content: [{
                            type: 'text',
                            text: `Invalid date format: ${since}. Please use ISO format like "2025-07-02T10:00:00Z"`
                        }]
                    };
                }
                memories = memories.filter(memory => new Date(memory.created_at) > sinceDate);
            }
            
            // Apply type filter if provided
            if (types && types.length > 0) {
                memories = memories.filter(memory => types.includes(memory.content_type as any));
            }
            
            // Limit results after filtering
            memories = memories.slice(0, limit);
            
            if (!memories.length) {
                return {
                    content: [{
                        type: 'text',
                        text: 'No recent memories found matching the specified criteria.'
                    }]
                };
            }
            
            // Format results based on requested format
            let formattedMemories;
            
            if (format === 'full') {
                formattedMemories = memories.map(memory => ({
                    ...memory,
                    memory_id: formatHashForDisplay(memory.memory_id)
                }));
            } else if (format === 'summary') {
                formattedMemories = memories.map(memory => {
                    const metadata = typeof memory.metadata === 'string' 
                        ? JSON.parse(memory.metadata) 
                        : memory.metadata;
                    return {
                        id: formatHashForDisplay(memory.memory_id),
                        type: memory.content_type,
                        preview: memory.content.substring(0, 150) + (memory.content.length > 150 ? '...' : ''),
                        status: metadata?.implementation_status,
                        created: memory.created_at
                    };
                });
            } else { // format === 'context'
                formattedMemories = await Promise.all(memories.map(async memory => {
                    const metadata = typeof memory.metadata === 'string' 
                        ? JSON.parse(memory.metadata) 
                        : memory.metadata;
                    
                    // Get tags if requested
                    let tags: string[] = [];
                    if (includeTags) {
                        try {
                            tags = await dbService.getMemoryTags(memory.memory_id);
                        } catch (error) {
                            // Continue without tags if there's an error
                            console.error('Error getting tags for memory:', error);
                        }
                    }
                    
                    return {
                        id: formatHashForDisplay(memory.memory_id),
                        type: memory.content_type,
                        content: memory.content,
                        status: metadata?.implementation_status,
                        keyDecisions: metadata?.key_decisions,
                        tags: tags,
                        created: memory.created_at,
                        age: `${Math.round((Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60))}h ago`
                    };
                }));
            }
            
            const response = {
                contextSummary: {
                    totalMemories: memories.length,
                    dateRange: {
                        oldest: memories[memories.length - 1]?.created_at,
                        newest: memories[0]?.created_at
                    },
                    types: [...new Set(memories.map(m => m.content_type))],
                    filter: {
                        since: since || 'none',
                        types: types || 'all',
                        limit: limit
                    }
                },
                memories: formattedMemories
            };
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(response, null, 2)
                }]
            };
        } catch (error) {
            return createErrorResponse(error, 'get-recent-context');
        }
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
    async ({ limit = 10, tag }) => {
        try {
            // Pass limit directly to database for efficient pagination
            const memories = await dbService.getDevMemories(limit);

            if (tag) {
                // TODO: Implement proper tag filtering using database queries
                console.error(`Note: Tag filtering for "${tag}" not yet implemented in list operation`);
                // For now, filter in memory but only on the already-limited results
                const filtered = memories.filter(memory => {
                    // This is a placeholder - proper implementation should use SQL filtering
                    return true; // TODO: implement tag filtering at DB level
                });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(filtered.map(memory => ({
                            ...memory,
                            memory_id: formatHashForDisplay(memory.memory_id)
                        })), null, 2)
                    }]
                };
            }
            
            // Format memories with hex IDs for display
            const displayMemories = memories.map(memory => ({
                ...memory,
                memory_id: formatHashForDisplay(memory.memory_id)
            }));
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(displayMemories, null, 2)
                }]
            };
        } catch (error) {
            return createErrorResponse(error, 'list-dev-memories');
        }
    }
);

// Add tool to get specific memory
server.tool(
    'get-dev-memory',
    'Retrieve a specific development memory by its hash ID. IDs are shown in hex format (e.g., a1b2c3d4e5f67890).',
    {
memoryId: z.string().describe('Hash ID of the memory to retrieve (hex format like a1b2c3d4e5f67890)')
    },
    async ({ memoryId }) => {
        try {
            // Convert hex format to hash ID for database lookup
            let hashId: string;
            try {
                hashId = parseHexToHash(memoryId);
                if (!isValidHashId(hashId)) {
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
            
            const memory = await dbService.getMemory(hashId);
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
                memory_id: formatHashForDisplay(memory.memory_id)
            };

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(displayMemory, null, 2)
                }]
            };
        } catch (error) {
            return createErrorResponse(error, 'get-dev-memory');
        }
    }
);

// Add tool for semantic search
server.tool(
    'search',
    'Find similar memories using AI-powered semantic search (pgvector). Returns results ranked by similarity.',
    {
        searchTerm: z.string().describe('Text to search for - finds semantically similar memories using AI embeddings')
    },
    async ({ searchTerm }) => {
        try {
            console.error('Searching for:', searchTerm);
            const memories = await dbService.findSimilarMemories(searchTerm, 5);
            console.error('Found memories:', memories.length);
            
            if (!memories.length) {
                return {
                    content: [{
                        type: 'text',
                        text: 'No similar memories found.'
                    }]
                };
            }

            const formattedResults = memories.map(memory => {
                const metadata = typeof memory.metadata === 'string' 
                    ? JSON.parse(memory.metadata) 
                    : memory.metadata;
                return {
                    id: formatHashForDisplay(memory.memory_id),  // Display as hex
                    similarity: `${((memory.similarity || 0) * 100).toFixed(1)}%`,
                    content: memory.content,
                    type: memory.content_type,
                    status: metadata.implementation_status,
                    keyDecisions: metadata.key_decisions,
                    created: memory.created_at
                };
            });

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(formattedResults, null, 2)
                }]
            };
        } catch (error) {
            console.error('Search error:', error);
            return createErrorResponse(error, 'search');
        }
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
    async ({ query, limit = 5, minSimilarity = 0.1, types, dateRange, showScores = true, includeTags = true, sortBy = 'similarity' }) => {
        try {
            console.error('Enhanced search for:', query);
            
            // Get more results initially to allow for filtering
            const initialLimit = limit * 3;
            let memories = await dbService.findSimilarMemories(query, initialLimit);
            console.error('Found memories before filtering:', memories.length);
            
            // Apply similarity threshold
            memories = memories.filter(memory => (memory.similarity || 0) >= minSimilarity);
            
            // Apply type filter
            if (types && types.length > 0) {
                memories = memories.filter(memory => types.includes(memory.content_type as any));
            }
            
            // Apply date range filter
            if (dateRange) {
                const fromDate = new Date(dateRange.from);
                const toDate = new Date(dateRange.to);
                
                if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
                    return {
                        isError: true,
                        content: [{
                            type: 'text',
                            text: `Invalid date format in dateRange. Please use ISO format like "2025-07-02T10:00:00Z"`
                        }]
                    };
                }
                
                memories = memories.filter(memory => {
                    const memoryDate = new Date(memory.created_at);
                    return memoryDate >= fromDate && memoryDate <= toDate;
                });
            }
            
            // Sort results
            if (sortBy === 'date') {
                memories = memories.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            } else if (sortBy === 'type') {
                memories = memories.sort((a, b) => a.content_type.localeCompare(b.content_type));
            }
            // similarity is already sorted by default from findSimilarMemories
            
            // Apply final limit
            memories = memories.slice(0, limit);
            
            if (!memories.length) {
                return {
                    content: [{
                        type: 'text',
                        text: `No memories found matching search criteria:\n- Query: "${query}"\n- Min similarity: ${minSimilarity}\n- Types: ${types?.join(', ') || 'all'}\n- Date range: ${dateRange ? `${dateRange.from} to ${dateRange.to}` : 'none'}`
                    }]
                };
            }
            
            // Format results with optional enrichments
            const formattedResults = await Promise.all(memories.map(async memory => {
                const metadata = typeof memory.metadata === 'string' 
                    ? JSON.parse(memory.metadata) 
                    : memory.metadata;
                
                let tags: string[] = [];
                if (includeTags) {
                    try {
                        tags = await dbService.getMemoryTags(memory.memory_id);
                    } catch (error) {
                        console.error('Error getting tags for memory:', error);
                    }
                }
                
                const result: any = {
                    id: formatHashForDisplay(memory.memory_id),
                    type: memory.content_type,
                    content: memory.content,
                    status: metadata?.implementation_status,
                    keyDecisions: metadata?.key_decisions,
                    created: memory.created_at,
                    age: `${Math.round((Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60))}h ago`
                };
                
                if (showScores) {
                    result.similarity = `${((memory.similarity || 0) * 100).toFixed(1)}%`;
                    result.score = (memory.similarity || 0).toFixed(3);
                }
                
                if (includeTags && tags.length > 0) {
                    result.tags = tags;
                }
                
                return result;
            }));
            
            const searchSummary = {
                searchQuery: query,
                totalResults: memories.length,
                appliedFilters: {
                    minSimilarity: minSimilarity,
                    types: types || 'all',
                    dateRange: dateRange || 'none',
                    sortBy: sortBy
                },
                resultRange: {
                    topSimilarity: showScores ? `${((memories[0]?.similarity || 0) * 100).toFixed(1)}%` : 'hidden',
                    lowestSimilarity: showScores ? `${((memories[memories.length - 1]?.similarity || 0) * 100).toFixed(1)}%` : 'hidden'
                }
            };
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        searchSummary,
                        results: formattedResults
                    }, null, 2)
                }]
            };
        } catch (error) {
            return createErrorResponse(error, 'enhanced search');
        }
    }
);

// Add tool to get all available tags
server.tool(
    'get-all-tags',
    'Get all available tags in the memory system for browsing and discovery.',
    {},
    async () => {
        try {
            const tags = await dbService.getDevTags();
            
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
            return createErrorResponse(error, 'retrieving tags');
        }
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
    async ({ tagName, limit = 10 }) => {
        try {
            const memories = await dbService.getDevMemoriesByTag(tagName, limit);
            
            if (!memories.length) {
                return {
                    content: [{
                        type: 'text',
                        text: `No memories found with tag "${tagName}".`
                    }]
                };
            }

            // Format memories with hex IDs for display
            const displayMemories = memories.map(memory => ({
                ...memory,
                memory_id: formatHashForDisplay(memory.memory_id)
            }));

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(displayMemories, null, 2)
                }]
            };
        } catch (error) {
            return createErrorResponse(error, 'listing memories by tag');
        }
    }
);

// Initialize server transport
const transport = new StdioServerTransport();
server.connect(transport);

console.error('Memory MCP Server started'); 