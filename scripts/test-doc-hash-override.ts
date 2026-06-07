#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2026-06-07
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// ------
// claude-mem/scripts/test-doc-hash-override.ts
//
// Issue #6 verification: POST /docs must derive doc_hash = sha256(content)
// server-side and ignore a client-supplied value (option a). Runs against a
// live claude-mem-http instance (CLAUDE_MEM_URL) + its Postgres.
//
//   CLAUDE_MEM_URL=http://localhost:3499 CLAUDE_MEM_SECRET=... npx tsx scripts/test-doc-hash-override.ts
//
// Exit 0 on pass, 1 on failure.

import { sha256Hex } from '../src/utils/hash.js';

const BASE = process.env['CLAUDE_MEM_URL'] ?? 'http://localhost:3499';
const SECRET = process.env['CLAUDE_MEM_SECRET'] ?? '';

function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (SECRET) h['x-claude-mem-secret'] = SECRET;
    return h;
}

async function main(): Promise<void> {
    // Unique per run so re-runs don't collide on the filepath conflict key.
    const stamp = process.hrtime.bigint().toString();
    const content = `# doc-hash override test\n\nDeliberately-wrong client hash, run ${stamp}.\n`;
    const filepath = `/tmp/claude-mem-doc-hash-test-${stamp}.md`;
    const doc_id = sha256Hex(filepath);          // mirrors the marker's doc_id derivation
    const expected = sha256Hex(content);         // what the server MUST store
    const WRONG = 'deadbeef'.repeat(8);          // 64 hex chars, but NOT sha256(content)

    if (WRONG === expected) throw new Error('test bug: WRONG collided with expected hash');

    // 1. POST /docs with a deliberately-wrong doc_hash.
    const postRes = await fetch(`${BASE}/docs`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            doc_id, filename: 'doc-hash-test.md', filepath,
            content, file_mtime: new Date(0).toISOString(), doc_hash: WRONG,
            metadata: { test: 'issue-6' },
        }),
    });
    if (!postRes.ok) throw new Error(`POST /docs failed: ${postRes.status} ${await postRes.text()}`);

    // 2. GET it back and read the stored doc_hash.
    const getRes = await fetch(`${BASE}/docs/${doc_id}`, { headers: headers() });
    if (!getRes.ok) throw new Error(`GET /docs/:doc_id failed: ${getRes.status} ${await getRes.text()}`);
    const { doc } = await getRes.json() as { doc: { doc_hash: string; content: string } };

    // 3. Assert: stored hash is sha256(content), NOT the wrong value the client sent.
    const stored = doc.doc_hash;
    if (stored === WRONG) {
        throw new Error(`FAIL: server stored the client's wrong doc_hash (${WRONG}) — not enforced`);
    }
    if (stored !== expected) {
        throw new Error(`FAIL: stored doc_hash ${stored} != sha256(content) ${expected}`);
    }
    if (doc.content !== content) {
        throw new Error('FAIL: stored content does not round-trip');
    }

    console.error('✅ issue #6: POST /docs with a wrong client doc_hash stored sha256(content) instead.');
    console.error(`   client sent : ${WRONG}`);
    console.error(`   server stored: ${stored} (== sha256(content))`);
}

main().catch((err) => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
