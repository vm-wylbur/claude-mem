// Author: PB and Claude
// Date: 2026-06-11
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// ---
// claude-mem/scripts/cleanup-legacy-ids.ts
//
// One-shot follow-up to #22 / migration 005: retire the NON-short legacy ids
// that 005's length<16 predicate deliberately skipped. Inventory (prod,
// 2026-06-11): 23 decimal-id test/debug rows from the 2025-07 BigInt->hex
// migration era (DELETE), 2 real ZFS notes + 1 real Aiven decision on
// decimal/sha256 ids (MIGRATE to canonical generateMemoryHash ids, carrying
// memory_tags/relationships/search-table refs), 3 real tags (code, testing,
// bug-fix) on decimal tag ids (MIGRATE to generateTagHash ids — safe because
// addMemoryTags resolves tags BY NAME, only hashing new names), and 1 junk
// test tag (DELETE). After this, migration 006's CHECK constraints make the
// backend enforce canonical id shape forever.
//
// Dry-run by default: prints the classification and the exact SQL. --apply
// executes it via ssh psql -1 (single transaction, FK drop/re-add around the
// id updates exactly like 005).
//
// Usage:
//   npx tsx scripts/cleanup-legacy-ids.ts            # dry-run
//   npx tsx scripts/cleanup-legacy-ids.ts --apply

import { execFileSync } from 'node:child_process';
import { initializeHasher, generateMemoryHash, generateTagHash } from '../src/utils/hash.js';

const JUNK_MEMORY_IDS = [
  '825243523905950871', '978986440796730823', '815400522123809907',
  '7763457138394677002', '9771585723478607926', '8259871048357416320',
  '1255378541743381457', '6459110810663407322', '1973746309908693850',
  '5339484742315413422', '3329523386410391086', '2199550069151594929',
  '15127759978607603002', '11212741836606398560', '14239839936489544584',
  '11668888619285978319', '15921441174602008399', '16096167834139135614',
  '11754775611771022083', '18237958052424431416', '18254415415257034628',
  '14043254054080430980', '10226491515656451411',
];
const MIGRATE_MEMORY_IDS = [
  '5126259141766117873',                                              // ZFS note (decision)
  '10215528874082477558',                                             // ZFS note (reference)
  '826d2412aefb8ad5670f2a180daf8ac409f219a2c2f96e564c4a64cba665c327', // Aiven decision (sha256-era id)
];
const JUNK_TAG_IDS = ['000000000test123'];
const MIGRATE_TAG_NAMES = ['code', 'testing', 'bug-fix'];

function psql(sql: string): string {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', 'snowball', 'psql -d claude_mem -qAt -f -'],
    { input: sql, encoding: 'utf8', timeout: 120_000 });
}

function q(s: string): string { return `'${s.replace(/'/g, "''")}'`; }

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  await initializeHasher();

  // Fetch the migrating rows' content to compute canonical ids.
  const rowsJson = psql(`SELECT json_agg(t) FROM (SELECT memory_id, content, content_type FROM memories WHERE memory_id IN (${MIGRATE_MEMORY_IDS.map(q).join(',')})) t;`).trim();
  const rows: Array<{ memory_id: string; content: string; content_type: string }> = JSON.parse(rowsJson) ?? [];
  if (rows.length !== MIGRATE_MEMORY_IDS.length) {
    console.error(`expected ${MIGRATE_MEMORY_IDS.length} migrate rows, found ${rows.length} — inventory drifted, aborting`);
    return 1;
  }
  const junkCount = psql(`SELECT count(*) FROM memories WHERE memory_id IN (${JUNK_MEMORY_IDS.map(q).join(',')});`).trim();

  const memMoves: Array<{ old: string; nu: string; label: string }> = [];
  for (const r of rows) {
    const nu = generateMemoryHash(r.content, r.content_type);
    const clash = psql(`SELECT count(*) FROM memories WHERE memory_id = ${q(nu)};`).trim();
    if (clash !== '0') {
      console.error(`canonical id ${nu} already exists (true near-dupe of ${r.memory_id}) — resolve manually, aborting`);
      return 1;
    }
    memMoves.push({ old: r.memory_id, nu, label: r.content.slice(0, 50).replace(/\n/g, ' ') });
  }
  const tagMoves: Array<{ old: string; nu: string; name: string }> = [];
  for (const name of MIGRATE_TAG_NAMES) {
    const old = psql(`SELECT tag_id FROM tags WHERE name = ${q(name)};`).trim();
    if (!old) { console.error(`tag ${name} not found — inventory drifted, aborting`); return 1; }
    const nu = generateTagHash(name);
    if (old === nu) continue; // already canonical
    tagMoves.push({ old, nu, name });
  }

  const stmts: string[] = [
    `ALTER TABLE memory_tags DROP CONSTRAINT IF EXISTS memory_tags_memory_id_fkey;`,
    `ALTER TABLE memory_tags DROP CONSTRAINT IF EXISTS memory_tags_tag_id_fkey;`,
    `ALTER TABLE memory_relationships DROP CONSTRAINT IF EXISTS memory_relationships_source_memory_id_fkey;`,
    `ALTER TABLE memory_relationships DROP CONSTRAINT IF EXISTS memory_relationships_target_memory_id_fkey;`,
    `DELETE FROM memory_tags WHERE memory_id IN (${JUNK_MEMORY_IDS.map(q).join(',')});`,
    `DELETE FROM memories WHERE memory_id IN (${JUNK_MEMORY_IDS.map(q).join(',')});`,
    `DELETE FROM memory_tags WHERE tag_id IN (${JUNK_TAG_IDS.map(q).join(',')});`,
    `DELETE FROM tags WHERE tag_id IN (${JUNK_TAG_IDS.map(q).join(',')});`,
  ];
  for (const m of memMoves) {
    stmts.push(
      `UPDATE memories SET memory_id = ${q(m.nu)} WHERE memory_id = ${q(m.old)};`,
      `UPDATE memory_tags SET memory_id = ${q(m.nu)} WHERE memory_id = ${q(m.old)};`,
      `UPDATE memory_relationships SET source_memory_id = ${q(m.nu)} WHERE source_memory_id = ${q(m.old)};`,
      `UPDATE memory_relationships SET target_memory_id = ${q(m.nu)} WHERE target_memory_id = ${q(m.old)};`,
      `UPDATE search_candidates SET memory_id = ${q(m.nu)} WHERE memory_id = ${q(m.old)};`,
      `UPDATE search_events SET returned_ids = array_replace(returned_ids, ${q(m.old)}, ${q(m.nu)}) WHERE ${q(m.old)} = ANY(returned_ids);`,
      `UPDATE extraction_decisions SET stored_memory_id = ${q(m.nu)} WHERE stored_memory_id = ${q(m.old)};`,
    );
  }
  for (const t of tagMoves) {
    stmts.push(
      `UPDATE tags SET tag_id = ${q(t.nu)} WHERE tag_id = ${q(t.old)};`,
      `UPDATE memory_tags SET tag_id = ${q(t.nu)} WHERE tag_id = ${q(t.old)};`,
    );
  }
  stmts.push(
    `ALTER TABLE memory_tags ADD CONSTRAINT memory_tags_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE;`,
    `ALTER TABLE memory_tags ADD CONSTRAINT memory_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE;`,
    `ALTER TABLE memory_relationships ADD CONSTRAINT memory_relationships_source_memory_id_fkey FOREIGN KEY (source_memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE;`,
    `ALTER TABLE memory_relationships ADD CONSTRAINT memory_relationships_target_memory_id_fkey FOREIGN KEY (target_memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE;`,
  );
  const sql = stmts.join('\n');

  console.log(`PLAN: delete ${junkCount} junk memories + ${JUNK_TAG_IDS.length} junk tag; migrate:`);
  for (const m of memMoves) console.log(`  memory ${m.old} -> ${m.nu}  (${m.label})`);
  for (const t of tagMoves) console.log(`  tag ${t.name}: ${t.old} -> ${t.nu}`);

  if (!apply) {
    console.log('\n--- SQL (dry-run, not executed) ---\n' + sql);
    console.log('\nDRY-RUN: re-run with --apply to execute in one transaction.');
    return 0;
  }
  psql('\\set ON_ERROR_STOP on\nBEGIN;\n' + sql + '\nCOMMIT;');
  const left = psql(`SELECT count(*) FROM memories WHERE memory_id !~ '^[0-9a-f]{16}$';`).trim();
  const leftTags = psql(`SELECT count(*) FROM tags WHERE tag_id !~ '^[0-9a-f]{16}$';`).trim();
  console.log(`\nAPPLIED. non-canonical remaining: memories=${left} tags=${leftTags}`);
  return 0;
}

main().then(c => process.exit(c));
