/*
Author: PB and Claude
Date: 2026-02-28
License: (c) HRDAG, 2025, GPL-2 or newer

---
claude-mem/src/index-http.ts
*/

// HTTP entry point. The sole client surface for claude-mem (the MCP transport
// was retired — see issue #4). Run on the machine that hosts PostgreSQL;
// clients reach it over Tailscale via the `~/.claude/lib/mem-*.sh` shims that
// curl these REST endpoints (/store, /recent, /search, /docs, /qfix-*).
//
// Auth: every request must carry `X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET}`
// when the server has CLAUDE_MEM_SECRET set (belt-and-suspenders over the
// Tailscale network boundary).

import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import express from 'express';
import { DatabaseService, QueueFixInput, QueueFixFilter, QueueFixConsumedOutcome, MemoryType, MemoryMetadata, MemoryProvenance, StoreMemoryOutcome } from './db/service.js';
import { createDatabaseAdapterToml } from './config.js';
import { getConfigSummaryToml } from './config-toml.js';
import { storeInitialProgress, storeDevProgress } from './dev-memory.js';
import { detectMemoryType, generateSmartTags } from './server.js';
import { QuickStoreTool } from './tools/quick-store.js';
import { GetRecentContextTool } from './tools/get-recent-context.js';
import { CANONICAL_ID_RE } from './utils/hash.js';

config();

const PORT = parseInt(process.env.CLAUDE_MEM_PORT ?? '3456', 10);
const SECRET = process.env.CLAUDE_MEM_SECRET;

console.error('Starting claude-mem HTTP server');
console.error(getConfigSummaryToml());
if (!SECRET) {
    console.error('WARNING: CLAUDE_MEM_SECRET not set — endpoint is unauthenticated');
}

const adapter = await createDatabaseAdapterToml();
const dbService = new DatabaseService(adapter);
await dbService.initialize();

// Seed guard is liveness-agnostic (counts tombstoned rows): an all-evicted
// dev project is NOT a fresh DB, and re-seeding would land invisibly on the
// tombstoned rows and re-fire every restart.
const existingCount = await dbService.countDevMemoriesIncludingEvicted();
if (existingCount === 0) {
    console.error('Storing initial development progress...');
    await storeInitialProgress(dbService);
} else {
    console.error(`Found ${existingCount} existing memories`);
}

async function storeMemoryWithTags(
    content: string,
    type: import('./db/service.js').MemoryType,
    metadata: Record<string, unknown>,
    tags?: string[],
    sourceKey?: string,
    provenance?: MemoryProvenance
): Promise<StoreMemoryOutcome> {
    const outcome = await storeDevProgress(dbService, content, type, metadata, sourceKey, undefined, provenance);
    // Tag-attach only when the write actually took effect on a LIVE row: a
    // refused keyed write must not mutate the owner's memory, and tagging a
    // tombstoned row would create phantom tags on invisible content.
    if (tags && tags.length > 0 && outcome.updated && !outcome.evicted) {
        await dbService.addMemoryTags(outcome.memoryId, tags);
    }
    return outcome;
}

const restQuickStore = new QuickStoreTool(dbService, storeMemoryWithTags, detectMemoryType, generateSmartTags);
const restRecentCtx = new GetRecentContextTool(dbService);

const app = express();
// Default Express JSON body limit is 100 KB; high-signal design/incident docs
// routinely exceed that (issue #8). 5 MB covers any realistic markdown doc.
app.use(express.json({ limit: '5mb' }));

// Belt-and-suspenders auth on top of Tailscale network-layer protection.
// If CLAUDE_MEM_SECRET is set, all requests must include the matching header.
app.use((req, res, next) => {
    if (SECRET && req.headers['x-claude-mem-secret'] !== SECRET) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    next();
});

// Shared optional-field stance (/store provenance, /search session_id,
// /search-verdict outcome): null/undefined = absent (back-compat: jq emits
// null for unset env vars); ''/non-string = a client bug — reject rather
// than silently dropping the field. Returns the string, undefined for
// absent, or null meaning INVALID (caller 400s).
function optionalString(v: unknown): string | undefined | null {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || v.length === 0) return null;
    return v;
}

// REST endpoints — the load-bearing client surface (hook scripts + lib shims).
app.post('/store', async (req: express.Request, res: express.Response): Promise<void> => {
    const { content, tags, source_key } = req.body as { content?: unknown; tags?: unknown; source_key?: unknown };
    if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content (string) required' });
        return;
    }
    // Provenance-on-write (Phase-A centerpiece).
    const provenance: MemoryProvenance = {};
    for (const name of ['session_id', 'host', 'agent_id'] as const) {
        const value = optionalString((req.body as Record<string, unknown>)[name]);
        if (value === null) {
            res.status(400).json({ error: `${name} must be a non-empty string when provided` });
            return;
        }
        if (value === undefined) continue;
        provenance[name] = value;
    }
    // Consolidation reverse edge (claude-mem#12): optional list of the
    // sibling memory_ids a survivor was synthesized from. Shape-only
    // validation (canonical 16-hex ids); existence/liveness of the ids is
    // verified verb-side by mem-forget.sh's evidence gate, not here.
    const consolidatedFromRaw = (req.body as Record<string, unknown>)['consolidated_from'];
    let consolidatedFrom: string[] | undefined;
    if (consolidatedFromRaw !== undefined && consolidatedFromRaw !== null) {
        const valid = Array.isArray(consolidatedFromRaw)
            && consolidatedFromRaw.length > 0
            && consolidatedFromRaw.length <= 100
            && consolidatedFromRaw.every(id => typeof id === 'string' && CANONICAL_ID_RE.test(id))
            && new Set(consolidatedFromRaw).size === consolidatedFromRaw.length;
        if (!valid) {
            res.status(400).json({ error: 'consolidated_from must be a non-empty array (max 100) of distinct 16-char lowercase hex memory_ids when provided' });
            return;
        }
        consolidatedFrom = consolidatedFromRaw as string[];
    }
    const result = await restQuickStore.handle({
        content,
        tags: Array.isArray(tags) ? tags : undefined,
        source_key: typeof source_key === 'string' && source_key.length > 0 ? source_key : undefined,
        provenance: Object.keys(provenance).length > 0 ? provenance : undefined,
        consolidated_from: consolidatedFrom
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

// Semantic search + IaC drift queue (mem-search + queue-fix-*).

app.post('/search', async (req: express.Request, res: express.Response): Promise<void> => {
    const { query, limit, session_id } = req.body as { query?: unknown; limit?: unknown; session_id?: unknown };
    if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'query (string) required' });
        return;
    }
    // Optional episode handle (typed onto search_events.session_id).
    const sessionId = optionalString(session_id);
    if (sessionId === null) {
        res.status(400).json({ error: 'session_id must be a non-empty string when provided' });
        return;
    }
    const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : 5;
    // search_id is unconditional (telemetry on or off): it is the correlation
    // handle the client echoes into POST /search-verdict.
    const searchId = randomUUID();
    const memories = await dbService.findSimilarMemories(query, n);
    res.json({ search_id: searchId, memories });
    // Capture-write: async fire-and-forget AFTER the response -- zero added
    // latency on the hot path; a capture failure is logged, never surfaced.
    void dbService.captureSearchEvent({
        search_id: searchId,
        query_text: query,
        session_id: sessionId,
        match_count: memories.length,
        returned_ids: memories.map(m => m.memory_id),
    }).catch(err => {
        console.error('search telemetry capture failed:', err instanceof Error ? err.message : err);
    });
});

// POST /search-verdict — the reader's sufficiency verdict for one /search
// call (one loop iteration; loop_id groups, loop_iteration orders). outcome
// is the loop's terminal label, sent ONCE on the final iteration. verdict/
// outcome enums are validated by the orchestrator verb-side; the engine
// stores TEXT.
app.post('/search-verdict', async (req: express.Request, res: express.Response): Promise<void> => {
    // ?? {}: express 5 leaves req.body undefined on a non-JSON content-type;
    // that's a malformed request (400), not a server fault (500).
    const b = (req.body ?? {}) as { search_id?: unknown; verdict?: unknown; iteration?: unknown; loop_id?: unknown; outcome?: unknown };
    if (typeof b.search_id !== 'string' || b.search_id.length === 0
        || typeof b.verdict !== 'string' || b.verdict.length === 0
        || typeof b.loop_id !== 'string' || b.loop_id.length === 0
        || typeof b.iteration !== 'number' || !Number.isInteger(b.iteration)
        || b.iteration < 1 || b.iteration > 2147483647) {  // loop_iteration is INT4
        res.status(400).json({
            error: 'search_id, verdict, loop_id (non-empty strings) and iteration (integer >= 1) required'
        });
        return;
    }
    const outcome = optionalString(b.outcome);
    if (outcome === null) {
        res.status(400).json({ error: 'outcome must be a non-empty string when provided' });
        return;
    }
    await dbService.recordSearchVerdict({
        search_id: b.search_id,
        verdict: b.verdict,
        iteration: b.iteration,
        loop_id: b.loop_id,
        outcome,
    });
    res.json({ success: true });
});

// GET /memory/:memory_id — full provenance + tombstone view, deliberately
// NOT evicted-filtered: this is the recovery/inspection surface (a wrongly
// forgotten memory must stay visible here), and the assertion target for
// the harvest-conformance provenance checks.
app.get('/memory/:memory_id', async (req: express.Request, res: express.Response): Promise<void> => {
    const memory = await dbService.getMemoryFull(req.params['memory_id']);
    if (!memory) {
        res.status(404).json({ error: 'memory not found' });
        return;
    }
    res.json({ memory });
});

// POST /memory/:memory_id/evict — the W5 forget-verb mutation surface
// (contract per claude-mem#12). evicted_by + evict_reason required; reason
// is free TEXT here, the structured-evidence enum (superseded-by <id> /
// contradicted-by-disk <path> / stale-as-of <date>) is validated verb-side.
// First-evictor-wins: re-evicting returns 200 with the ORIGINAL tombstone
// and already_evicted=true, never clobbering the first actor/reason.
app.post('/memory/:memory_id/evict', async (req: express.Request, res: express.Response): Promise<void> => {
    const b = (req.body ?? {}) as { evicted_by?: unknown; evict_reason?: unknown };
    if (typeof b.evicted_by !== 'string' || b.evicted_by.length === 0
        || typeof b.evict_reason !== 'string' || b.evict_reason.length === 0) {
        res.status(400).json({ error: 'evicted_by and evict_reason (non-empty strings) required' });
        return;
    }
    const result = await dbService.evictMemory(req.params['memory_id'], b.evicted_by, b.evict_reason);
    if (!result) {
        res.status(404).json({ error: 'memory not found' });
        return;
    }
    res.json(result);
});

// POST /memory/:memory_id/unevict — the explicit recovery surface (clears
// the tombstone). Idempotent: unevicting a live row is a 200 no-op with
// was_evicted=false.
app.post('/memory/:memory_id/unevict', async (req: express.Request, res: express.Response): Promise<void> => {
    const result = await dbService.unevictMemory(req.params['memory_id']);
    if (!result) {
        res.status(404).json({ error: 'memory not found' });
        return;
    }
    res.json(result);
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
    // doc_hash stays in the required set for request back-compat (clients and the
    // pinned conformance suite still send it), but the value is advisory only —
    // the service recomputes doc_hash = sha256(content) and ignores what the
    // client sent (issue #6 / neg-305c49e5). We do not forward b.doc_hash.
    if (!b.doc_id || !b.filename || !b.filepath || !b.content || !b.file_mtime || !b.doc_hash) {
        res.status(400).json({ error: 'doc_id, filename, filepath, content, file_mtime, doc_hash required' });
        return;
    }
    await dbService.upsertLessonsLearnedDoc({
        doc_id: b.doc_id, filename: b.filename, filepath: b.filepath,
        content: b.content, file_mtime: b.file_mtime,
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
    // Provenance: same three optional fields and stance as /store (W9 /
    // harvest-conformance). With W8's no-clobber rule keyed on
    // agent_id IS NOT NULL, harvested memories must be able to carry their
    // writer's identity (the distiller's agent id, the harvest host).
    const provenance: MemoryProvenance = {};
    for (const name of ['session_id', 'host', 'agent_id'] as const) {
        const value = optionalString((req.body as Record<string, unknown>)[name]);
        if (value === null) {
            res.status(400).json({ error: `${name} must be a non-empty string when provided` });
            return;
        }
        if (value === undefined) continue;
        provenance[name] = value;
    }
    const outcome = await storeDevProgress(
        dbService, b.content, type, b.metadata ?? {},
        typeof b.source_key === 'string' && b.source_key.length > 0 ? b.source_key : undefined,
        typeof b.source_doc_id === 'string' && b.source_doc_id.length > 0 ? b.source_doc_id : undefined,
        Object.keys(provenance).length > 0 ? provenance : undefined,
    );
    // Same live-row tag rule as /store: no tags on refused or tombstoned rows.
    if (Array.isArray(b.tags) && b.tags.length > 0 && outcome.updated && !outcome.evicted) {
        await dbService.addMemoryTags(outcome.memoryId, b.tags);
    }
    // W8 signals (claude-mem#12): evicted = sticky-tombstone collision (the
    // distiller records skip:tombstoned-collision and must NOT retire the
    // doc); updated:false + deferred_to = keyed no-clobber refusal.
    res.json({
        success: true,
        memoryId: outcome.memoryId,
        ...(outcome.evicted ? { evicted: true } : {}),
        ...(outcome.updated ? {} : { updated: false, deferred_to: outcome.deferred_to ?? null }),
    });
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
    console.error(`claude-mem HTTP server listening on port ${PORT}`);
});
