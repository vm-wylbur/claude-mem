// Author: PB and Claude
// Date: 2026-06-09
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// ------
// claude-mem/src/db/rerank.ts
//
// bge cross-encoder rerank slot for /search (Phase-A A6, neg-2baa74e7).
// The bake-off verdict: bge-reranker-v2-m3 ALONE, no fusion guard, ColBERT
// benched (~/docs/claude-mem/bandb-findings-20260607.md). This module is the
// thin client; the caller (DatabaseService.findSimilarMemories) fetches a
// hybrid pool-with-content, reranks it here, and slices top-k -- degrading to
// the hybrid order on ANY failure (the rerank is a quality boost, never a
// dependency).
//
// Reorder logic is a faithful port of eval/bakeoff-score-bge-scott.py's
// rerank_order(): JinaAI-style POST, sort by relevance desc, dedupe by index,
// append any unreturned candidates in pool order. truncate_prompt_tokens=512
// is mandatory -- scott's vLLM REJECTS docs >512 tokens with HTTP 400 (verified
// live 2026-06-09); this restores the truncate-to-512 the Band-A run measured.

import fs from 'fs';
import os from 'os';
import path from 'path';

export interface RerankConfig {
  url: string;
  model: string;
  key: string;
  timeoutMs: number;
  pool: number;            // hybrid candidates to rerank before slicing top-k
  truncateTokens: number;  // truncate_prompt_tokens; MUST be <= the served model's max-len
}

const FLAG_RE = /^(1|true|yes|on)$/i;

/**
 * Resolve rerank config from the environment, or null if rerank is off or the
 * bearer cannot be loaded. SPOT for the key: the canonical hrdag bearer file
 * (default ~/.config/hrdag/api, parse `API_KEY=`) -- the same source the offline
 * harness reads. The key is never copied into a claude-mem env var. A set flag
 * with no resolvable key returns null (logged) so /search degrades to hybrid
 * rather than 500ing on every request.
 */
export function rerankConfigFromEnv(): RerankConfig | null {
  if (!FLAG_RE.test(process.env.MCPMEM_RERANK ?? '')) return null;

  const url = process.env.MCPMEM_RERANK_URL ?? 'http://scott:8585/rerank';
  const model = process.env.MCPMEM_RERANK_MODEL ?? 'bge-reranker-v2-m3';
  const keyFile = process.env.MCPMEM_RERANK_KEY_FILE ?? path.join(os.homedir(), '.config/hrdag/api');
  const timeoutMs = Number(process.env.MCPMEM_RERANK_TIMEOUT_MS ?? '5000') || 5000;
  const pool = Number(process.env.MCPMEM_RERANK_POOL ?? '50') || 50;
  const truncateTokens = Number(process.env.MCPMEM_RERANK_TRUNCATE ?? '512') || 512;

  let key = '';
  try {
    for (const ln of fs.readFileSync(keyFile, 'utf-8').split('\n')) {
      if (ln.startsWith('API_KEY=')) { key = ln.slice('API_KEY='.length).trim(); break; }
    }
  } catch {
    // unreadable/missing file -> falls through to the no-key warning below
  }

  if (!key) {
    console.error(`MCPMEM_RERANK is set but no API_KEY at ${keyFile}; rerank disabled, using hybrid order.`);
    return null;
  }
  return { url, model, key, timeoutMs, pool, truncateTokens };
}

interface RerankResult { index: number; relevance_score: number; }

/**
 * Reorder `candidates` by bge relevance (desc). Generic over the candidate
 * shape so it returns exactly what it was given, reordered -- no coupling to
 * the Memory type. Throws on any transport/protocol failure; the caller is
 * responsible for the degrade-to-hybrid catch.
 */
export async function rerankByBge<T extends { memory_id: string; content: string }>(
  query: string,
  candidates: T[],
  cfg: RerankConfig,
): Promise<T[]> {
  if (candidates.length === 0) return candidates;

  const body = JSON.stringify({
    model: cfg.model,
    query,
    documents: candidates.map(c => c.content),
    truncate_prompt_tokens: cfg.truncateTokens,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) throw new Error(`rerank HTTP ${resp.status}`);
  const data = await resp.json() as { results?: RerankResult[] };
  if (!Array.isArray(data.results)) throw new Error('rerank: malformed response (missing results[])');

  // Drop malformed elements (a non-finite score would make the comparator
  // return NaN -> implementation-defined order, silently demoting good hits),
  // then sort desc by score; dedupe by index; append any candidate the reranker
  // did not return, in original pool order (matches the offline harness exactly).
  const ranked = data.results
    .filter(r => Number.isFinite(r.relevance_score))
    .sort((a, b) => b.relevance_score - a.relevance_score);
  const seen = new Set<number>();
  const order: T[] = [];
  for (const r of ranked) {
    if (Number.isInteger(r.index) && r.index >= 0 && r.index < candidates.length && !seen.has(r.index)) {
      seen.add(r.index);
      order.push(candidates[r.index]);
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    if (!seen.has(i)) order.push(candidates[i]);
  }
  return order;
}
