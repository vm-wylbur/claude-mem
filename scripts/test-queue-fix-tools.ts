#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2026-04-29
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// scripts/test-queue-fix-tools.ts
//
// Integration test for the IaC drift queue (queue_fixes table + 3 tools).
// Connects to the live claude-mem PostgreSQL database, exercises a full
// store/list/mark round-trip against an isolated test target_repo, then
// cleans up after itself.
//
// Usage:
//   MCPMEM_DB_TYPE=postgresql npx tsx scripts/test-queue-fix-tools.ts
//
// Side effects:
//   - Creates queue_fix rows with target_repo='__test_queue_fix__'
//   - Deletes those rows at end (success or failure via finally)

import { config } from 'dotenv';
import { getDatabaseConfigToml } from '../src/config-toml.js';
import { PostgresAdapter } from '../src/db/adapters/postgres.js';
import { DatabaseService } from '../src/db/service.js';
import { QueueFixStoreTool } from '../src/tools/queue-fix-store.js';
import { QueueFixListTool } from '../src/tools/queue-fix-list.js';
import { QueueFixMarkTool } from '../src/tools/queue-fix-mark.js';

config();

const TEST_REPO = '__test_queue_fix__';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function check(name: string, cond: boolean, detail?: string) {
  results.push({ name, passed: cond, detail });
  console.error(`  ${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function parseToolResult(r: any): any {
  // Tools return MCPResponse with content[0].text as JSON
  if (r.isError) throw new Error(`tool error: ${r.content?.[0]?.text}`);
  return JSON.parse(r.content[0].text);
}

async function main() {
  const dbConfig = await getDatabaseConfigToml();
  if (dbConfig.type !== 'postgresql') {
    console.error('❌ TOML config does not declare postgresql');
    process.exit(1);
  }

  const adapter = new PostgresAdapter(dbConfig);
  await adapter.connect();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();

  const storeTool = new QueueFixStoreTool(dbService);
  const listTool = new QueueFixListTool(dbService);
  const markTool = new QueueFixMarkTool(dbService);

  console.error('🧪 queue_fix tools integration test\n');

  let firstId: number | undefined;
  let secondId: number | undefined;
  let thirdId: number | undefined;

  try {
    // 1. Store first entry
    console.error('Test 1: store first entry');
    {
      const r = parseToolResult(
        await storeTool.handle({
          target_repo: TEST_REPO,
          host: 'test-host-A',
          path: '/tmp',
          before_state: '755 root:root',
          after_state: '1777 root:root',
          why: 'ext4 fs root created 755 by mkfs.ext4',
          suggested_role: 'zfs-storage',
          who: 'test-runner',
          trust: 'PB',
        })
      );
      check('store returns success+id', r.success === true && typeof r.id === 'number', `id=${r.id}`);
      check('initial status is open', r.status === 'open');
      firstId = r.id;
    }

    // 2. Store a second entry (different host, same target_repo)
    console.error('\nTest 2: store second entry');
    {
      const r = parseToolResult(
        await storeTool.handle({
          target_repo: TEST_REPO,
          host: 'test-host-B',
          path: '/etc/foo.conf',
          after_state: 'bar=baz',
          why: 'enable foo',
          who: 'test-runner',
          metadata: { issue: 999 },
        })
      );
      check('second store success', r.success === true);
      secondId = r.id;
      check('ids unique', firstId !== secondId);
    }

    // 3. List open entries — expect 2
    console.error('\nTest 3: list open entries');
    {
      const r = parseToolResult(
        await listTool.handle({ target_repo: TEST_REPO, status: 'open' })
      );
      check('list returns 2 open entries', r.count === 2, `count=${r.count}`);
      check('ordered by created_at ASC',
        r.entries[0].id === firstId && r.entries[1].id === secondId,
        `ids=[${r.entries[0]?.id},${r.entries[1]?.id}] expected=[${firstId},${secondId}]`
      );
      check('first entry has all fields',
        r.entries[0].host === 'test-host-A' &&
          r.entries[0].path === '/tmp' &&
          r.entries[0].before_state === '755 root:root' &&
          r.entries[0].after_state === '1777 root:root' &&
          r.entries[0].who === 'test-runner' &&
          r.entries[0].trust === 'PB' &&
          r.entries[0].suggested_role === 'zfs-storage'
      );
      check('second entry preserves metadata',
        r.entries[1].metadata?.issue === 999,
        `metadata=${JSON.stringify(r.entries[1].metadata)}`
      );
      check('second entry has null before_state', r.entries[1].before_state === null);
    }

    // 4. Mark first entry consumed
    console.error('\nTest 4: mark first entry consumed');
    {
      const r = parseToolResult(
        await markTool.handle({
          id: firstId!,
          status: 'consumed',
          consumed_by_commit: 'abc123',
          consumed_in_repo: 'hrdag-ansible',
          consumed_in_path: 'roles/zfs-storage/tasks/main.yml',
        })
      );
      check('mark consumed success', r.success === true);
    }

    // 5. List open — expect 1 left
    console.error('\nTest 5: list open after consume');
    {
      const r = parseToolResult(
        await listTool.handle({ target_repo: TEST_REPO, status: 'open' })
      );
      check('1 open remaining', r.count === 1, `count=${r.count}`);
      check('remaining is the second entry', r.entries[0].id === secondId);
    }

    // 6. List consumed — expect 1
    console.error('\nTest 6: list consumed');
    {
      const r = parseToolResult(
        await listTool.handle({ target_repo: TEST_REPO, status: 'consumed' })
      );
      check('1 consumed entry', r.count === 1);
      const e = r.entries[0];
      check('consumed entry has commit metadata',
        e.consumed_by_commit === 'abc123' &&
          e.consumed_in_repo === 'hrdag-ansible' &&
          e.consumed_in_path === 'roles/zfs-storage/tasks/main.yml'
      );
      check('consumed_at populated', e.consumed_at !== null);
    }

    // 7. Mark consumed twice — expect failure (status guard)
    console.error('\nTest 7: cannot re-consume same entry');
    {
      let threw = false;
      try {
        await markTool.handle({
          id: firstId!,
          status: 'consumed',
          consumed_by_commit: 'def456',
          consumed_in_repo: 'foo',
          consumed_in_path: 'bar',
        });
      } catch (e) {
        threw = true;
      }
      // Tool catches and returns error response, not throws
      const r = await markTool.handle({
        id: firstId!,
        status: 'consumed',
        consumed_by_commit: 'def456',
        consumed_in_repo: 'foo',
        consumed_in_path: 'bar',
      });
      check('re-consume returns error', r.isError === true,
        `text=${r.content?.[0]?.text?.substring(0, 80)}`
      );
    }

    // 8. Escalate the second entry
    console.error('\nTest 8: escalate second entry');
    {
      const r = parseToolResult(
        await markTool.handle({
          id: secondId!,
          status: 'escalated',
          escalation_reason: 'cannot determine which role owns this',
        })
      );
      check('escalate success', r.success === true);

      const list = parseToolResult(
        await listTool.handle({ target_repo: TEST_REPO, status: 'escalated' })
      );
      check('1 escalated', list.count === 1);
      check('escalation reason recorded',
        list.entries[0].escalation_reason === 'cannot determine which role owns this'
      );
    }

    // 9. Add a third entry and supersede it
    console.error('\nTest 9: supersede flow');
    {
      const r1 = parseToolResult(
        await storeTool.handle({
          target_repo: TEST_REPO,
          host: 'test-host-C',
          path: '/etc/old.conf',
          after_state: 'old',
          why: 'first attempt',
          who: 'test-runner',
        })
      );
      thirdId = r1.id;

      const r2 = parseToolResult(
        await storeTool.handle({
          target_repo: TEST_REPO,
          host: 'test-host-C',
          path: '/etc/old.conf',
          after_state: 'new',
          why: 'second attempt - replaces first',
          who: 'test-runner',
        })
      );

      const mark = parseToolResult(
        await markTool.handle({
          id: thirdId!,
          status: 'superseded',
          superseded_by: r2.id,
        })
      );
      check('supersede success', mark.success === true);

      const list = parseToolResult(
        await listTool.handle({ target_repo: TEST_REPO, status: 'superseded' })
      );
      check('1 superseded', list.count === 1);
      check('superseded_by id correct',
        list.entries[0].superseded_by === r2.id,
        `got=${list.entries[0].superseded_by} expected=${r2.id}`
      );
    }

    // 10. Test missing required fields on consumed
    console.error('\nTest 10: validation — consumed requires commit/repo/path');
    {
      const r1 = parseToolResult(
        await storeTool.handle({
          target_repo: TEST_REPO,
          host: 'test-host-D',
          path: '/etc/x',
          after_state: 'x',
          why: 'x',
          who: 'test-runner',
        })
      );
      const r = await markTool.handle({
        id: r1.id,
        status: 'consumed',
        // missing the required outcome fields
      });
      check('consumed without outcome fields → error', r.isError === true);
    }

    // Print summary
    const failed = results.filter((r) => !r.passed);
    console.error('\n' + '='.repeat(60));
    console.error(`Tests run: ${results.length} | Passed: ${results.length - failed.length} | Failed: ${failed.length}`);
    if (failed.length > 0) {
      console.error('\nFailed tests:');
      for (const f of failed) {
        console.error(`  ❌ ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
      }
      process.exitCode = 1;
    } else {
      console.error('✅ All tests passed');
    }
  } finally {
    // Cleanup: nuke all test rows for this target_repo
    console.error('\n🧹 Cleaning up test rows...');
    const pool = (adapter as any).pool;
    const client = await pool.connect();
    try {
      // Delete in two passes because of self-FK (superseded_by)
      await client.query(`UPDATE queue_fixes SET superseded_by = NULL WHERE target_repo = $1`, [TEST_REPO]);
      const del = await client.query(`DELETE FROM queue_fixes WHERE target_repo = $1`, [TEST_REPO]);
      console.error(`   Deleted ${del.rowCount} test rows`);
    } finally {
      client.release();
    }
    await adapter.disconnect();
  }
}

main().catch((e) => {
  console.error('\n💥 Unhandled:', e.message);
  console.error(e.stack);
  process.exit(2);
});
