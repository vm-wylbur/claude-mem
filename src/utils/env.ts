// Author: PB and Claude
// Date: 2026-06-10
// License: (c) HRDAG, 2026, GPL-2 or newer
//
// ---
// claude-mem/src/utils/env.ts

// CLAUDE_MEM_* is the canonical env-var prefix; MCPMEM_* is the deprecated
// MCP-era spelling kept as a one-release fallback (claude-mem#14, the MCP
// transport itself was retired in #4). Reads the new name first, falls back
// to the legacy name with a warn-once deprecation line so a missed setter
// fails loud in the logs, not silent.
const warnedLegacy = new Set<string>();

export function memEnv(suffix: string): string | undefined {
    const current = process.env[`CLAUDE_MEM_${suffix}`];
    if (current !== undefined) return current;
    const legacy = process.env[`MCPMEM_${suffix}`];
    if (legacy !== undefined && !warnedLegacy.has(suffix)) {
        warnedLegacy.add(suffix);
        console.error(`DEPRECATED: MCPMEM_${suffix} is set — rename to CLAUDE_MEM_${suffix} (claude-mem#14)`);
    }
    return legacy;
}
