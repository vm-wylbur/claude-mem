// Author: PB and Claude
// Date: 2026-06-11
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// ---
// claude-mem/scripts/test-db-guard.ts
//
// Prod-write guard for the DB-touching test scripts. These tests connect via
// the default TOML loader, which on a workstation points at PRODUCTION
// snowball — on 2026-06-11 the tag-contract tests leaked 4 test memories
// into the live store before anyone noticed. Every test script that WRITES
// through the adapter must call assertTestDatabase() before connecting.
//
// Policy: the configured target must be local (localhost/127.0.0.1) AND the
// database name must end in "test". CLAUDE_MEM_ALLOW_PROD_TESTS=1 overrides
// for the rare deliberate case (e.g. a disposable instance that doesn't fit
// the naming rule) — the override names itself loudly in the output.

import { getDatabaseConfigToml } from '../src/config-toml.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export async function assertTestDatabase(): Promise<void> {
  if (/^(1|true|yes)$/i.test(process.env.CLAUDE_MEM_ALLOW_PROD_TESTS ?? '')) {
    console.error('⚠️  CLAUDE_MEM_ALLOW_PROD_TESTS set — test-DB guard bypassed deliberately');
    return;
  }
  const cfg = await getDatabaseConfigToml();
  const pg = cfg.postgresql;
  const hosts = pg?.hosts ?? [];
  const db = pg?.database ?? '';
  const localOnly = hosts.length > 0 && hosts.every(h => LOCAL_HOSTS.has(h));
  const testNamed = /test$/i.test(db);
  if (!localOnly || !testNamed) {
    console.error(
      `\n🛑 test-DB guard: refusing to run write-tests against hosts=[${hosts.join(',')}] db=${db}.\n` +
      `   These tests INSERT rows. Point the config at a local throwaway DB whose name\n` +
      `   ends in "test" (isolated $HOME + claude-mem.toml), or set\n` +
      `   CLAUDE_MEM_ALLOW_PROD_TESTS=1 if you really mean it.\n`
    );
    process.exit(2);
  }
}
