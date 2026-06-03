/*
Author: PB and Claude
Date: 2026-02-28
License: (c) HRDAG, 2025, GPL-2 or newer

---
claude-mem/src/index-http.ts
*/

// HTTP entry point. Exposes the MCP server over Streamable HTTP for multi-machine access.
// Run on the machine that hosts PostgreSQL; clients connect via Tailscale.
//
// Client config (~/.claude.json):
//   {
//     "mcpServers": {
//       "claude-mem": {
//         "type": "http",
//         "url": "http://snowball.tailnet:3456/mcp",
//         "headers": { "X-Claude-Mem-Secret": "${CLAUDE_MEM_SECRET}" }
//       }
//     }
//   }
//
// Or via CLI:
//   claude mcp add --transport http --scope user claude-mem \
//     http://snowball.tailnet:3456/mcp \
//     --header "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET}"

import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseService, QueueFixInput, QueueFixFilter, QueueFixConsumedOutcome, MemoryType, MemoryMetadata } from './db/service.js';
import { createDatabaseAdapterToml } from './config.js';
import { getConfigSummaryToml } from './config-toml.js';
import { storeInitialProgress, storeDevProgress } from './dev-memory.js';
import { createServer, createLiteServer, detectMemoryType, generateSmartTags } from './server.js';
import { QuickStoreTool } from './tools/quick-store.js';
import { GetRecentContextTool } from './tools/get-recent-context.js';

config();

const PORT = parseInt(process.env.CLAUDE_MEM_PORT ?? '3456', 10);
const SECRET = process.env.CLAUDE_MEM_SECRET;

console.error('Starting Memory MCP Server (HTTP)');
console.error(getConfigSummaryToml());
if (!SECRET) {
    console.error('WARNING: CLAUDE_MEM_SECRET not set — endpoint is unauthenticated');
}

const adapter = await createDatabaseAdapterToml();
const dbService = new DatabaseService(adapter);
await dbService.initialize();

const existingMemories = await dbService.getDevMemories();
if (existingMemories.length === 0) {
    console.error('Storing initial development progress...');
    await storeInitialProgress(dbService);
} else {
    console.error(`Found ${existingMemories.length} existing memories`);
}

async function storeMemoryWithTags(
    content: string,
    type: import('./db/service.js').MemoryType,
    metadata: Record<string, unknown>,
    tags?: string[],
    sourceKey?: string
): Promise<string> {
    const memoryId = await storeDevProgress(dbService, content, type, metadata, sourceKey);
    if (tags && tags.length > 0) {
        await dbService.addMemoryTags(memoryId, tags);
    }
    return memoryId;
}

const restQuickStore = new QuickStoreTool(dbService, storeMemoryWithTags, detectMemoryType, generateSmartTags);
const restRecentCtx = new GetRecentContextTool(dbService);

const app = express();
app.use(express.json());

// Belt-and-suspenders auth on top of Tailscale network-layer protection.
// If CLAUDE_MEM_SECRET is set, all requests must include the matching header.
app.use((req, res, next) => {
    if (SECRET && req.headers['x-claude-mem-secret'] !== SECRET) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    next();
});

// REST endpoints for hook scripts (simpler than full MCP protocol).
app.post('/store', async (req: express.Request, res: express.Response): Promise<void> => {
    const { content, tags, source_key } = req.body as { content?: unknown; tags?: unknown; source_key?: unknown };
    if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content (string) required' });
        return;
    }
    const result = await restQuickStore.handle({
        content,
        tags: Array.isArray(tags) ? tags : undefined,
        source_key: typeof source_key === 'string' && source_key.length > 0 ? source_key : undefined
    });
    const storeBlock = result.content[0] as { type: 'text'; text: string };
    res.json(JSON.parse(storeBlock.text));
});

app.get('/recent', async (req: express.Request, res: express.Response): Promise<void> => {
    const n = Math.min(parseInt(req.query['n'] as string) || 3, 50);
    const project = req.query['project'] as string | undefined;

    if (project) {
        const memories = await dbService.getMemoriesByTag(project, undefined, n);
        const formatted = await Promise.all(memories.map(async m => ({
            type: m.content_type,
            content: m.content,
            tags: await dbService.getMemoryTags(m.memory_id)
        })));
        res.json({ memories: formatted });
        return;
    }

    const result = await restRecentCtx.handle({ limit: n, format: 'context' });
    const recentBlock = result.content[0] as { type: 'text'; text: string };
    res.json(JSON.parse(recentBlock.text));
});

// Plain-REST equivalents of four MCP tools (mem-search + queue-fix-*).
// Lets clients invoke without speaking MCP — see issue #2.

app.post('/search', async (req: express.Request, res: express.Response): Promise<void> => {
    const { query, limit } = req.body as { query?: unknown; limit?: unknown };
    if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'query (string) required' });
        return;
    }
    const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : 5;
    const memories = await dbService.findSimilarMemories(query, n);
    res.json({ memories });
});

// ── Doc harvester: lessons_learned_docs + memories.source_doc_id + extraction_decisions.
// The distiller is the client — GET the manifest for change-detection/dedup,
// upsert the raw doc, store distilled memories linked by source_doc_id, and log
// every keep/edit/skip into the labeled set. See docs/harvester-plan-20260531.md.

app.get('/docs/manifest', async (_req: express.Request, res: express.Response): Promise<void> => {
    const docs = await dbService.getLessonsLearnedDocs();
    res.json({ docs });
});

// GET /docs/backlog — distill's worklist (replaces its ssh-psql query).
// MUST be registered before GET /docs/:doc_id, or the param route captures
// "backlog" as a doc_id. ("manifest" above is safe — it is registered first.)
app.get('/docs/backlog', async (req: express.Request, res: express.Response): Promise<void> => {
    // Clamp explicitly: a negative limit is truthy (so `|| 50` would not fire)
    // and reaches Postgres as `LIMIT -5`, a syntax error. <=0 / NaN -> default.
    const rawLimit = parseInt(req.query['limit'] as string, 10);
    const rawOffset = parseInt(req.query['offset'] as string, 10);
    const limit = Math.min(rawLimit > 0 ? rawLimit : 50, 500);
    const offset = rawOffset > 0 ? rawOffset : 0;
    const { docs, total } = await dbService.getBacklogDocs(limit, offset);
    res.json({ docs, limit, offset, total });
});

// GET /docs/:doc_id — full doc incl. content (replaces eval's load_docs).
// Param route: keep last among the /docs GETs so /manifest and /backlog win.
app.get('/docs/:doc_id', async (req: express.Request, res: express.Response): Promise<void> => {
    const doc = await dbService.getDoc(req.params['doc_id']);
    if (!doc) {
        res.status(404).json({ error: 'doc not found' });
        return;
    }
    res.json({ doc });
});

app.post('/docs', async (req: express.Request, res: express.Response): Promise<void> => {
    const b = req.body as Partial<{
        doc_id: string; filename: string; filepath: string;
        content: string; file_mtime: string; doc_hash: string; metadata: unknown;
    }>;
    if (!b.doc_id || !b.filename || !b.filepath || !b.content || !b.file_mtime || !b.doc_hash) {
        res.status(400).json({ error: 'doc_id, filename, filepath, content, file_mtime, doc_hash required' });
        return;
    }
    await dbService.upsertLessonsLearnedDoc({
        doc_id: b.doc_id, filename: b.filename, filepath: b.filepath,
        content: b.content, file_mtime: b.file_mtime, doc_hash: b.doc_hash,
        metadata: b.metadata ?? {},
    });
    res.json({ success: true, doc_id: b.doc_id });
});

const HARVEST_TYPES: readonly MemoryType[] = ['conversation', 'code', 'decision', 'reference'];

app.post('/harvest', async (req: express.Request, res: express.Response): Promise<void> => {
    const b = req.body as Partial<{
        content: string; content_type: MemoryType; tags: string[];
        source_key: string; source_doc_id: string; metadata: Partial<MemoryMetadata>;
    }>;
    if (!b.content || typeof b.content !== 'string') {
        res.status(400).json({ error: 'content (string) required' });
        return;
    }
    const type: MemoryType = b.content_type ?? 'reference';
    if (!HARVEST_TYPES.includes(type)) {
        res.status(400).json({ error: `content_type must be one of ${HARVEST_TYPES.join('|')}` });
        return;
    }
    const memoryId = await storeDevProgress(
        dbService, b.content, type, b.metadata ?? {},
        typeof b.source_key === 'string' && b.source_key.length > 0 ? b.source_key : undefined,
        typeof b.source_doc_id === 'string' && b.source_doc_id.length > 0 ? b.source_doc_id : undefined,
    );
    if (Array.isArray(b.tags) && b.tags.length > 0) {
        await dbService.addMemoryTags(memoryId, b.tags);
    }
    res.json({ success: true, memoryId });
});

app.post('/decision', async (req: express.Request, res: express.Response): Promise<void> => {
    const b = req.body as Partial<{
        doc_id: string; doc_filename: string; insight_number: number;
        insight_title: string; insight_content: string; insight_tags: string[];
        action: string; edited_content: string; skip_reason: string; stored_memory_id: string;
    }>;
    const allowed = ['approved', 'edited', 'skipped'];
    if (!b.doc_filename || typeof b.insight_number !== 'number' || !b.insight_content
        || !b.action || !allowed.includes(b.action)) {
        res.status(400).json({
            error: 'doc_filename, insight_number (number), insight_content, action (approved|edited|skipped) required'
        });
        return;
    }
    const decision_id = await dbService.recordExtractionDecision({
        doc_id: b.doc_id ?? null,
        doc_filename: b.doc_filename,
        insight_number: b.insight_number,
        insight_title: b.insight_title ?? null,
        insight_content: b.insight_content,
        insight_tags: Array.isArray(b.insight_tags) ? b.insight_tags : null,
        action: b.action as 'approved' | 'edited' | 'skipped',
        edited_content: b.edited_content ?? null,
        skip_reason: b.skip_reason ?? null,
        stored_memory_id: b.stored_memory_id ?? null,
    });
    res.json({ success: true, decision_id });
});

app.post('/qfix-store', async (req: express.Request, res: express.Response): Promise<void> => {
    const b = req.body as Partial<QueueFixInput>;
    if (!b.target_repo || !b.host || !b.path || !b.after_state || !b.why || !b.who) {
        res.status(400).json({
            error: 'target_repo, host, path, after_state, why, who are all required'
        });
        return;
    }
    const input: QueueFixInput = {
        target_repo: b.target_repo,
        host: b.host,
        path: b.path,
        before_state: b.before_state ?? null,
        after_state: b.after_state,
        why: b.why,
        suggested_role: b.suggested_role,
        who: b.who,
        trust: b.trust,
        metadata: b.metadata,
    };
    const id = await dbService.createQueueFix(input);
    res.json({ id });
});

app.get('/qfix-list', async (req: express.Request, res: express.Response): Promise<void> => {
    const q = req.query;
    const allowed: Array<QueueFixFilter['status']> = ['open', 'consumed', 'escalated', 'superseded'];
    const statusParam = q['status'] as string | undefined;
    if (statusParam !== undefined && !allowed.includes(statusParam as QueueFixFilter['status'])) {
        res.status(400).json({ error: `status must be one of ${allowed.join('|')}` });
        return;
    }
    const limitNum = q['limit'] ? parseInt(q['limit'] as string, 10) : undefined;
    const filter: QueueFixFilter = {
        target_repo: q['target_repo'] as string | undefined,
        status: statusParam as QueueFixFilter['status'] | undefined,
        host: q['host'] as string | undefined,
        limit: Number.isFinite(limitNum) ? limitNum : undefined,
    };
    const entries = await dbService.listQueueFixes(filter);
    res.json(entries);
});

app.post('/qfix-mark', async (req: express.Request, res: express.Response): Promise<void> => {
    const b = req.body as {
        id?: unknown; status?: unknown;
        consumed_by_commit?: unknown; consumed_in_repo?: unknown; consumed_in_path?: unknown;
        escalation_reason?: unknown; superseded_by?: unknown;
    };
    if (typeof b.id !== 'number') {
        res.status(400).json({ error: 'id (number) required' });
        return;
    }
    if (b.status === 'consumed') {
        const commit = b.consumed_by_commit, repo = b.consumed_in_repo, path = b.consumed_in_path;
        if (typeof commit !== 'string' || typeof repo !== 'string' || typeof path !== 'string') {
            res.status(400).json({
                error: 'consumed requires consumed_by_commit, consumed_in_repo, consumed_in_path (all strings)'
            });
            return;
        }
        const outcome: QueueFixConsumedOutcome = { commit, repo, path };
        await dbService.markQueueFixConsumed(b.id, outcome);
    } else if (b.status === 'escalated') {
        if (typeof b.escalation_reason !== 'string') {
            res.status(400).json({ error: 'escalated requires escalation_reason (string)' });
            return;
        }
        await dbService.markQueueFixEscalated(b.id, b.escalation_reason);
    } else if (b.status === 'superseded') {
        if (typeof b.superseded_by !== 'number') {
            res.status(400).json({ error: 'superseded requires superseded_by (number)' });
            return;
        }
        await dbService.markQueueFixSuperseded(b.id, b.superseded_by);
    } else {
        res.status(400).json({
            error: 'status must be consumed | escalated | superseded'
        });
        return;
    }
    res.json({ success: true });
});

function makeHandler(serverFactory: () => McpServer) {
    const transports = new Map<string, StreamableHTTPServerTransport>();

    return async function(req: express.Request, res: express.Response): Promise<void> {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (req.method === 'POST' && !sessionId) {
            if (!isInitializeRequest(req.body)) {
                res.status(400).json({ error: 'expected initialize request' });
                return;
            }
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (id) => {
                    transports.set(id, transport);
                    console.error(`Session initialized: ${id}`);
                },
            });
            transport.onclose = () => {
                if (transport.sessionId) {
                    transports.delete(transport.sessionId);
                    console.error(`Session closed: ${transport.sessionId}`);
                }
            };
            const server = serverFactory();
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return;
        }

        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
            res.status(404).json({ error: `session not found: ${sessionId}` });
            return;
        }
        await transport.handleRequest(req, res, req.body);
    };
}

app.all('/mcp', makeHandler(() => createLiteServer(dbService)));
app.all('/mcp/full', makeHandler(() => createServer(dbService)));

// JSON error handler (registered last). Express 5 forwards rejected async
// handlers here; without it a DB/FK error (e.g. POST /harvest before the doc
// is POST /docs'd) returns an opaque HTML 500 instead of the {error} JSON
// shape every handler uses for its 4xx. Network is Tailscale + secret-gated,
// so surfacing the message is acceptable and useful for the harvester client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction): void => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('REST handler error:', msg);
    if (!res.headersSent) {
        res.status(500).json({ error: msg });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.error(`Memory MCP Server (HTTP) listening on port ${PORT}`);
});
