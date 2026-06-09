#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2026-06-09
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// ------
// claude-mem/scripts/test-rerank.ts

/**
 * Rerank-slot unit tests (Phase-A A6). Pure unit tests: globalThis.fetch is
 * stubbed, so no live scott:8585 and no DB. Covers the bge reorder logic
 * (relevance desc, unreturned-appended, empty short-circuit), the failure
 * modes the caller degrades on (HTTP !ok, malformed body), the mandatory
 * truncate_prompt_tokens=512 in the request, and rerankConfigFromEnv's
 * off/no-key resolution.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { rerankByBge, rerankConfigFromEnv, type RerankConfig } from '../src/db/rerank.js';

interface TestResult { name: string; passed: boolean; error?: string; }
const results: TestResult[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  results.push({ name, passed: cond, error: cond ? undefined : detail });
}
async function checkThrows(name: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); results.push({ name, passed: false, error: 'expected throw, got none' }); }
  catch { results.push({ name, passed: true }); }
}

const CFG: RerankConfig = { url: 'http://stub/rerank', model: 'bge-reranker-v2-m3', key: 'k', timeoutMs: 1000, pool: 50, truncateTokens: 512 };
const realFetch = globalThis.fetch;

// Install a fetch stub. `mk` builds the Response-like object from the captured
// request body; `captured` lets a test inspect what was sent.
let captured: { url: string; body: any } | null = null;
function stubFetch(mk: (body: any) => { ok: boolean; status: number; json: () => Promise<any> }): void {
  globalThis.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    captured = { url: String(url), body };
    return mk(body) as unknown as Response;
  }) as typeof fetch;
}
function restoreFetch(): void { globalThis.fetch = realFetch; captured = null; }

const POOL = [
  { memory_id: 'm0', content: 'doc zero' },
  { memory_id: 'm1', content: 'doc one' },
  { memory_id: 'm2', content: 'doc two' },
];

async function run(): Promise<void> {
  console.error('🧪 Rerank-slot unit tests\n=========================\n');

  // 1. Reorder by relevance desc: index 2 best, then 0, then 1.
  stubFetch(() => ({ ok: true, status: 200, json: async () => ({ results: [
    { index: 1, relevance_score: 0.1 },
    { index: 2, relevance_score: 0.9 },
    { index: 0, relevance_score: 0.5 },
  ] }) }));
  let out = await rerankByBge('q', POOL, CFG);
  check('reorders by relevance desc', out.map(m => m.memory_id).join(',') === 'm2,m0,m1',
    `got ${out.map(m => m.memory_id).join(',')}`);

  // 2. Mandatory truncate_prompt_tokens=512 + documents are the contents.
  check('sends truncate_prompt_tokens=512', captured?.body.truncate_prompt_tokens === 512,
    `got ${captured?.body.truncate_prompt_tokens}`);
  check('sends documents = contents',
    JSON.stringify(captured?.body.documents) === JSON.stringify(['doc zero', 'doc one', 'doc two']));

  // 3. Unreturned indices appended in original pool order.
  stubFetch(() => ({ ok: true, status: 200, json: async () => ({ results: [
    { index: 2, relevance_score: 0.9 },
  ] }) }));
  out = await rerankByBge('q', POOL, CFG);
  check('appends unreturned in pool order', out.map(m => m.memory_id).join(',') === 'm2,m0,m1',
    `got ${out.map(m => m.memory_id).join(',')}`);

  // 3b. Non-finite relevance_score elements are dropped (no NaN-comparator
  // demotion); the finite-scored candidates still order correctly.
  stubFetch(() => ({ ok: true, status: 200, json: async () => ({ results: [
    { index: 0, relevance_score: null as unknown as number },
    { index: 2, relevance_score: 0.9 },
    { index: 1, relevance_score: 0.3 },
  ] }) }));
  out = await rerankByBge('q', POOL, CFG);
  check('drops non-finite scores, orders the rest', out.map(m => m.memory_id).join(',') === 'm2,m1,m0',
    `got ${out.map(m => m.memory_id).join(',')}`);

  // 4. Out-of-range / duplicate indices are ignored (no crash, no dupes).
  stubFetch(() => ({ ok: true, status: 200, json: async () => ({ results: [
    { index: 99, relevance_score: 1.0 }, { index: 1, relevance_score: 0.8 }, { index: 1, relevance_score: 0.7 },
  ] }) }));
  out = await rerankByBge('q', POOL, CFG);
  check('ignores OOB+dup indices', out.map(m => m.memory_id).join(',') === 'm1,m0,m2',
    `got ${out.map(m => m.memory_id).join(',')}`);

  // 5. Empty pool short-circuits without a fetch.
  captured = null;
  out = await rerankByBge('q', [], CFG);
  check('empty pool returns [] with no fetch', out.length === 0 && captured === null);

  // 6. HTTP !ok throws (caller degrades to hybrid).
  stubFetch(() => ({ ok: false, status: 400, json: async () => ({}) }));
  await checkThrows('throws on HTTP 400', () => rerankByBge('q', POOL, CFG));

  // 7. Malformed body (no results[]) throws.
  stubFetch(() => ({ ok: true, status: 200, json: async () => ({ nope: true }) }));
  await checkThrows('throws on malformed response', () => rerankByBge('q', POOL, CFG));
  restoreFetch();

  // 8. rerankConfigFromEnv: off when flag unset.
  const savedFlag = process.env.MCPMEM_RERANK;
  const savedKeyFile = process.env.MCPMEM_RERANK_KEY_FILE;
  delete process.env.MCPMEM_RERANK;
  check('config null when flag unset', rerankConfigFromEnv() === null);

  // 9. Flag set but key file missing -> null (service degrades to hybrid).
  process.env.MCPMEM_RERANK = '1';
  process.env.MCPMEM_RERANK_KEY_FILE = path.join(os.tmpdir(), 'definitely-absent-bearer-xyz');
  check('config null when bearer missing', rerankConfigFromEnv() === null);

  // 10. Flag set + key file present -> config with the parsed key.
  const tmp = path.join(os.tmpdir(), `rerank-key-${process.pid}`);
  fs.writeFileSync(tmp, 'SOMETHING=x\nAPI_KEY=secret-bearer-123\n');
  process.env.MCPMEM_RERANK_KEY_FILE = tmp;
  const cfg = rerankConfigFromEnv();
  check('config loads key from file (SPOT)', cfg?.key === 'secret-bearer-123', `got ${cfg?.key}`);
  check('config defaults pool=50, truncate=512', cfg?.pool === 50 && cfg?.truncateTokens === 512,
    `got pool=${cfg?.pool} truncate=${cfg?.truncateTokens}`);
  fs.unlinkSync(tmp);

  // restore env
  if (savedFlag === undefined) delete process.env.MCPMEM_RERANK; else process.env.MCPMEM_RERANK = savedFlag;
  if (savedKeyFile === undefined) delete process.env.MCPMEM_RERANK_KEY_FILE; else process.env.MCPMEM_RERANK_KEY_FILE = savedKeyFile;

  // report
  let failed = 0;
  for (const r of results) {
    console.error(`${r.passed ? '✅' : '❌'} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
    if (!r.passed) failed++;
  }
  console.error(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error('test harness error:', e); process.exit(1); });
