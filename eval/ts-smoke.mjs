// Author: PB and Claude
// Date: 2026-05-31
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// claude-mem/eval/ts-smoke.mjs
//
// End-to-end check of the TypeScript hybrid path (adapter -> service ->
// search_hybrid on snowball), exercising the MCPMEM_HYBRID_SEARCH flag.
// Run twice (flag off/on) and report the rank of a target the vector path
// misses. Throwaway harness; not shipped in the server.
//
//   node eval/ts-smoke.mjs            # flag off (vector)
//   MCPMEM_HYBRID_SEARCH=1 node eval/ts-smoke.mjs

import { createDatabaseAdapterToml } from '../dist/config.js';
import { DatabaseService } from '../dist/db/service.js';

const QUERY = 'upsmon -c fsd is destructive not a probe';
const TARGET = '2dc5cf492ed6a658';

const adapter = await createDatabaseAdapterToml();
const svc = new DatabaseService(adapter);
await svc.initialize();

const rows = await svc.findSimilarMemories(QUERY, 10);
const rank = rows.findIndex(r => r.memory_id === TARGET);

const mode = /^(1|true|yes|on)$/i.test(process.env.MCPMEM_HYBRID_SEARCH ?? '') ? 'HYBRID' : 'vector';
console.log(`mode=${mode}  target rank=${rank < 0 ? 'MISS' : rank + 1}  n=${rows.length}`);
console.log(`  top3: ${rows.slice(0, 3).map(r => `${r.memory_id}(sim=${(r.similarity ?? 0).toFixed(2)})`).join('  ')}`);
console.log(`  metadata present on row0: ${rows[0]?.metadata != null}`);
process.exit(0);
