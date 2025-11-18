<!--
Author: PB and Claude
Date: 2025-11-18
License: (c) HRDAG, 2025, GPL-2 or newer

------
docs/lessons-learned-docs-implementation.md
-->

# Lessons-Learned Documentation Storage - Implementation Notes

**Date**: 2025-11-18
**Status**: Foundation complete, TypeScript compilation pending
**Next Session**: Fix DatabaseService integration

---

## Architecture Decision: Simple 2-Layer Approach

### Rejected: 3-Layer with Full Embeddings
Initially proposed:
- Layer 1: Full docs (with embedding)
- Layer 2: Sections (with embeddings)
- Layer 3: Insights (with embeddings)

**Rejected because:**
- 90+ embeddings for 15 docs (storage/generation cost)
- Over-engineering for "accumulation + iteration" use case
- Unnecessary complexity (3 tables, cascade deletes)
- Skills need insights, not section-level search

### Accepted: 2-Layer Reference + Search
```sql
lessons_learned_docs (full text, NO embedding)
  ↓ source_doc_id
memories (insights with embedding)
```

**Why this works:**
- Full docs are **reference only** (no search, just retrieval)
- Insights are **searchable knowledge** (only these need embeddings)
- Simple: Parse sections on-demand when viewing
- Iterative: "Trivial to reprocess" - just re-extract insights
- Accumulation-friendly: Ingest = just store text, extraction later

---

## Database Schema

### Table: lessons_learned_docs
```sql
CREATE TABLE lessons_learned_docs (
    doc_id TEXT PRIMARY KEY,          -- blake3(filepath) - NOTE: using sha256 temporarily
    filename TEXT NOT NULL,            -- "bad-recovery-drive.md"
    filepath TEXT NOT NULL UNIQUE,     -- "/home/pball/docs/bad-recovery-drive.md"
    content TEXT NOT NULL,             -- Full markdown content
    file_mtime TIMESTAMPTZ NOT NULL,   -- Source file modification time
    doc_hash TEXT NOT NULL,            -- blake3(content) for change detection
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'        -- {word_count, extracted_insights_count}
);
```

**Indexes:**
- `idx_docs_filepath` - Fast lookup by path
- `idx_docs_doc_hash` - Change detection
- `idx_docs_file_mtime` - Find recently updated

### Link: memories.source_doc_id
```sql
ALTER TABLE memories
  ADD COLUMN source_doc_id TEXT REFERENCES lessons_learned_docs(doc_id);

CREATE INDEX idx_memories_source_doc_id ON memories(source_doc_id);
```

**Use case:** Memory → "read full source doc" for context

---

## Implementation Progress

### ✅ Completed
1. **Database schema** - Applied to Aiven PostgreSQL
2. **Tool skeleton** - `src/tools/sync-docs.ts` created with:
   - Discovery logic (scan ~/docs + $PWD/docs for *.md)
   - Change detection (mtime + content hash)
   - Ingestion workflow
   - Summary formatting
3. **Tool registration** - Added to src/index.ts

### ❌ TypeScript Compilation Errors
```
src/tools/sync-docs.ts(147,47): error TS2339: Property 'db' does not exist on type 'DatabaseService'.
src/tools/sync-docs.ts(159,60): error TS2339: Property 'doc_hash' does not exist on type '{}'.
src/tools/sync-docs.ts(179,28): error TS2339: Property 'db' does not exist on type 'DatabaseService'.
```

**Root cause:** DatabaseService uses adapter pattern, no direct SQL access

**Fix options for next session:**
1. **Add methods to DatabaseService** - Clean but verbose
   ```typescript
   async getLessonsLearnedDocs(): Promise<LessonsLearnedDoc[]>
   async upsertLessonsLearnedDoc(doc: LessonsLearnedDoc): Promise<void>
   ```

2. **Expose adapter for raw queries** - Quick but breaks encapsulation
   ```typescript
   public getAdapter(): DatabaseAdapter { return this.adapter; }
   ```

3. **Use postgres-mcp tool from within claude-mem** - Unconventional but works
   ```typescript
   // Call postgres-mcp execute_sql from sync-docs tool
   ```

**Recommendation:** Option 1 (add proper methods) for clean architecture

---

## Discovery Pattern

**Default directories:**
- `$HOME/docs` (always checked)
- `$PWD/docs` (if exists and different from HOME)

**File discovery:**
- Scan for `*.md` files only
- Skip directories
- Read full content for hashing

**Change detection:**
```
1. Get existing docs from database (filepath → doc_hash map)
2. For each discovered file:
   - New: filepath not in database
   - Updated: doc_hash changed
   - Unchanged: doc_hash matches
3. Ingest new + updated only
```

---

## Tool Interface

### Tool: sync-docs
```typescript
{
  directories?: string[],  // Override default ~/docs + $PWD/docs
  forceUpdate?: boolean    // Re-ingest even if unchanged
}
```

**Returns:**
```
✅ Documentation sync complete

Scanned directories:
  - /home/pball/docs
  - /home/pball/projects/claude-mem/docs

Results:
  📄 Total files found: 18
  ✨ New documents: 4
  🔄 Updated documents: 1
  ✓  Unchanged: 13

New documents:
  + claudes-recovery-20251117.md
  + claudes-bad-day-20251112.md
  ...

Ingested 5 documents to database.

📝 Next step: Extract insights from new documents using memory extraction workflow.
```

---

## Blake3 Note

**Current:** Using sha256 (Node.js built-in)
**Future:** Add blake3 npm package for performance

```typescript
// Temporary implementation:
private blake3Hash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

// TODO: Replace with actual blake3 when package added
```

---

## Future Enhancements

### Extraction Automation
Currently planned as separate step. Could add:
- Auto-extraction on ingest (background job)
- Confidence scoring for extracted insights
- Link insights to source docs automatically

### Section Parsing
Parse markdown headers on-demand:
```typescript
function parseMarkdownSections(content: string): Section[] {
  // Split by ##, ###, #### headers
  // Return array of {heading, level, content}
}
```

**Use case:** Display document with TOC, jump to sections

### Full-Text Search
Could add PostgreSQL full-text search on content:
```sql
ALTER TABLE lessons_learned_docs ADD COLUMN content_tsv tsvector;
CREATE INDEX idx_docs_fts ON lessons_learned_docs USING gin(content_tsv);
```

**Use case:** Traditional keyword search as complement to vector search

---

## Testing Plan (Next Session)

1. **Fix TypeScript compilation**
   - Add DatabaseService methods for lessons_learned_docs
   - Or expose adapter with justification

2. **Build and deploy**
   ```bash
   npm run build
   # Restart MCP server to load new tool
   ```

3. **Test ingestion**
   ```
   Use mcp__claude-mem__sync-docs tool
   Verify 18 docs from ~/docs ingested
   Check database: SELECT COUNT(*) FROM lessons_learned_docs
   ```

4. **Test change detection**
   - Modify one doc
   - Run sync-docs again
   - Verify only updated doc re-ingested

5. **Test slash command** (future)
   - Create ~/.claude/commands/getdocs.md
   - Calls sync-docs tool
   - Provides nice summary

---

## Command vs Skill vs Tool - Decision

**User asked:** "Explain Command/Skill/MCP tool in detail"

**Conclusion:**
- **MCP Tool** = Real code, reliable execution (what we're building)
- **Slash Command** = User-invokable wrapper for MCP tool
- **Skill** = Auto-activates on keywords, integrates with other skills

**Implementation order:**
1. MCP tool (sync-docs) - foundation ✓ (pending TS fixes)
2. Slash command (/getdocs) - nice UX (future)
3. Skill (docs-sync) - automatic triggering (future)

---

## Key Learnings

1. **Start simple** - 2-layer beats 3-layer for this use case
2. **Full docs as reference** - No need to embed everything
3. **Iterate on extraction** - Store docs first, improve extraction later
4. **DatabaseService pattern** - Clean but requires proper method additions
5. **User workflow** - "Accumulation + iteration" drives architecture

---

## Files Modified

- `src/schema-postgresql.sql` - Added lessons_learned_docs table
- `src/tools/sync-docs.ts` - New tool (needs TS fixes)
- `src/index.ts` - Registered sync-docs tool
- Database - Applied schema to Aiven PostgreSQL

---

## Next Steps

1. Fix TypeScript compilation errors
2. Add DatabaseService methods for doc operations
3. Build and test sync-docs tool
4. Ingest existing 18 markdown files from ~/docs
5. Test change detection workflow
6. Create /getdocs slash command
7. Optional: Add blake3 package for better hashing

---

**Status**: Foundation solid, implementation 80% complete, needs DatabaseService integration work.
