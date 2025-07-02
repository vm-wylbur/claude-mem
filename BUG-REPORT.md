# Bug Report: PostgreSQL Memory System Issues

## Bug #1: Intermittent Search JSON Parsing Errors

**Status:** 🔴 Active  
**Priority:** Medium  
**Component:** Database Adapter - Search Function

### Symptoms
- `search` tool occasionally returns: `Error searching memories: SyntaxError: "[object Object]" is not valid JSON`
- Error appears intermittent - same search queries work on retry  
- `list-dev-memories` and `get-dev-memory` functions work consistently
- Observed during multi-Claude instance testing

### Reproduction Steps
1. Call search with any searchTerm (e.g., "PostgreSQL migration")
2. Sometimes returns valid JSON results, sometimes SyntaxError
3. No clear pattern for when error occurs vs success

### Expected vs Actual Behavior
- **Expected:** Consistent JSON array of memory objects with similarity scores
- **Actual:** Intermittent JSON parsing failures

### Technical Analysis
- Suggests response object serialization issue in search implementation
- Error format indicates object being stringified incorrectly as `[object Object]`
- PostgreSQL backend with pgvector, SSH tunnels (snowl/snowball)
- Hash-based memory IDs in use

---

## Bug #2: Database Schema Issue - Missing tag_name Column

**Status:** 🔴 Active  
**Priority:** High  
**Component:** Database Schema - Tags Table

### Symptoms
- Memory storage fails with: `error: column "tag_name" of relation "tags" does not exist`
- Affects `store-dev-memory` operations when tags are provided
- Schema mismatch between expected and actual PostgreSQL table structure

### Impact
- Cannot store memories with tags
- Memory system functionality partially broken

### Technical Context
- PostgreSQL deployment
- Suggests schema migration incomplete or divergent from SQLite version
- Tags functionality broken in PostgreSQL but worked in SQLite

---

## Environment
- **Database:** PostgreSQL with pgvector on snowball
- **Connection:** SSH tunnels (snowl LAN / snowball Tailscale fallback)  
- **IDs:** Hash-based memory IDs
- **Config:** TOML-based configuration system
- **Status:** Production PostgreSQL deployment

## Next Steps for dev-claude
1. **Bug #1:** Investigate search response serialization in PostgreSQL adapter
2. **Bug #2:** Check PostgreSQL schema vs SQLite schema for tags table structure
3. Run schema sync script: `./scripts/sync-schema.sh`
4. Verify tag table has correct column names (`tag_name` vs `name`)

## Workarounds
- **Search:** Retry failed searches (usually works on second attempt)
- **Tags:** Avoid using tags in `store-dev-memory` until schema fixed
