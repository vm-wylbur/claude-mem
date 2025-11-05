<!--
Author: PB and Claude
Date: 2025-11-04
License: (c) HRDAG, 2025, GPL-2 or newer

------
skills/postgres-optimization/SKILL.md
-->

# PostgreSQL Optimization Skill

## Mission

Guide intelligent PostgreSQL database optimization by combining **institutional knowledge** from past optimizations (claude-mem) with **live database analysis** (postgres-mcp). Apply proven patterns from history while adapting to current database state.

**Core Philosophy**: Learn from every optimization, never repeat mistakes, and build expertise over time.

## When This Skill Activates

Activate when user requests:
- Database performance optimization
- Query tuning or slow query analysis
- Index recommendations or creation
- Database health checks
- PostgreSQL troubleshooting
- Schema optimization

**Activation Keywords**: "optimize database", "slow query", "performance tuning", "analyze query", "database health", "index strategy", "postgres performance"

## Workflow Phases

### Phase 1: Research - Search Institutional Knowledge

**Before touching the database**, search memory for relevant patterns:

1. **Search for similar optimization work**:
   ```
   Use mcp__claude-mem__search-enhanced with queries like:
   - "PostgreSQL query optimization indexing performance"
   - "slow query [specific table/operation type]"
   - "database health analysis vacuum bloat"
   ```

2. **Review past decisions**:
   - What solutions worked in similar situations?
   - What approaches failed and why?
   - What performance baselines were established?
   - What architectural patterns were used?

3. **Present findings to user**:
   ```
   🔍 Searching memory for similar optimization patterns...

   Found relevant experience:
   - [Memory ID]: [Summary of past optimization]
   - Key insight: [What worked/didn't work]
   - Performance impact: [Metrics if available]
   ```

### Phase 2: Live Analysis - Current Database State

Use postgres-mcp tools to understand **what's happening now**:

1. **Database Health Check** (always start here):
   ```
   Use mcp__postgres-mcp__analyze_db_health to check:
   - Buffer cache hit rates
   - Connection health
   - Constraint validation
   - Index bloat and unused indexes
   - Sequence limits
   - Vacuum status and dead tuples
   ```

2. **Identify Slow Queries**:
   ```
   Use mcp__postgres-mcp__get_top_queries to find:
   - Slowest queries by total execution time
   - Resource-intensive operations
   - Optimization targets
   ```

3. **Analyze Specific Queries**:
   ```
   Use mcp__postgres-mcp__explain_query to:
   - View execution plans
   - Identify sequential scans
   - Test hypothetical indexes
   - Understand query costs
   ```

4. **Get Index Recommendations**:
   ```
   Use mcp__postgres-mcp__analyze_workload_indexes for:
   - Automated index suggestions
   - Resource-intensive query identification
   - Principled indexing strategies
   ```

### Phase 3: Synthesis - Combine Past + Present

**Intelligent recommendation engine**:

1. **Match patterns from memory with current analysis**:
   - "Similar to [memory ID], where reverse indexes solved 100M row table performance"
   - "Current database shows same symptoms: sequential scans on large table"
   - "Recommended approach: Apply proven pattern with adaptations for current schema"

2. **Present actionable recommendations**:
   ```
   💡 Optimization Strategy:

   Based on past experience + current analysis:

   1. [Recommendation with rationale]
      - Past evidence: [Memory reference]
      - Current data: [postgres-mcp finding]
      - Expected impact: [Estimated improvement]

   2. [Alternative approach if applicable]
      - Trade-offs: [Explain pros/cons]

   3. [Maintenance recommendations]
      - VACUUM, ANALYZE, etc.
   ```

3. **Test before implementing**:
   ```
   Use mcp__postgres-mcp__explain_query with hypothetical indexes:
   - Show estimated query plan improvements
   - Calculate cost reduction
   - Verify approach before execution
   ```

### Phase 4: Implementation - Execute & Verify

**Safe execution with verification**:

1. **Confirm with user before executing**:
   ```
   Ready to implement optimization:

   SQL to execute:
   CREATE INDEX idx_users_email ON users(email);

   Expected improvement: 234ms → 2.3ms (99% reduction)

   Proceed? (I'll use postgres-mcp execute_sql)
   ```

2. **Execute the optimization**:
   ```
   Use mcp__postgres-mcp__execute_sql
   ```

3. **Verify improvement**:
   ```
   - Re-run explain_query to confirm plan changed
   - Check get_top_queries for improvement
   - Run analyze_db_health for any side effects
   ```

### Phase 5: Documentation - Store Learnings

**Build institutional knowledge**:

1. **Store optimization in memory**:
   ```
   Use mcp__claude-mem__store-dev-memory with:

   Type: decision
   Content: Complete description of:
     - Problem: What was slow and why
     - Analysis: What tools revealed
     - Solution: What was implemented
     - Results: Performance improvement metrics
     - Key decisions: Why this approach vs alternatives

   Tags: ["postgresql", "optimization", "indexing", "performance", ...]
   Status: completed
   ```

2. **Include all relevant context**:
   - Table names and sizes
   - Query patterns
   - Index definitions
   - Before/after metrics
   - Execution plan changes

3. **Document failures too**:
   - If an optimization doesn't work, store that
   - Explain why it failed
   - What was learned
   - Prevents repeating mistakes

## Guardrails - Safety Constraints

### Read-Only by Default

**NEVER execute DDL/DML without explicit user confirmation**:
- ✓ Always use analyze_db_health, explain_query (read-only tools)
- ✓ Show SQL commands to user before execution
- ✗ NEVER auto-execute CREATE INDEX, DROP INDEX, VACUUM
- ✗ NEVER execute DELETE, UPDATE, TRUNCATE without explicit request
- ✗ NEVER modify data, only structure (and only when confirmed)

### Confirmation Required For

1. **Creating indexes**: Show disk space impact, lock implications
2. **Dropping indexes**: Verify index is truly unused (check pg_stat_user_indexes)
3. **VACUUM operations**: Explain impact on active queries
4. **Schema changes**: Always get explicit approval

### Prohibited Actions

- **NEVER DROP tables, databases, or critical indexes**
- **NEVER modify production data** (UPDATE/DELETE) as part of optimization
- **NEVER disable constraints** or foreign keys
- **NEVER suggest VACUUM FULL** without explaining lock implications
- **NEVER recommend turning off autovacuum**

### Best Practices Enforcement

1. **Always check pg_stat_statements first** before optimizing
2. **Always test with EXPLAIN** before creating indexes
3. **Always consider index size vs benefit trade-off**
4. **Always check for index bloat before creating new indexes**
5. **Always recommend ANALYZE after creating indexes**
6. **Always consider write performance impact** (indexes slow INSERTs)

## Integration - Tool Reference

### Memory Tools (claude-mem MCP server)

**Search and Discovery**:
- `mcp__claude-mem__search-enhanced`: Semantic search for past optimizations
  - Use detailed queries: "PostgreSQL query optimization large table indexing"
  - Set minSimilarity: 0.3-0.5 for broad pattern matching
  - Request scores to understand relevance

- `mcp__claude-mem__list-memories-by-tag`: Browse by category
  - Tags: "postgresql", "indexing", "performance", "query-optimization"

- `mcp__claude-mem__get-recent-context`: Recent PostgreSQL work
  - Types: ["decision", "code"] for optimization history

**Documentation**:
- `mcp__claude-mem__store-dev-memory`: Store optimization learnings
  - Type: "decision" for optimization decisions
  - Type: "code" for schema changes
  - Type: "reference" for general PostgreSQL knowledge
  - Always include: keyDecisions, status, tags

### Database Analysis Tools (postgres-mcp MCP server)

**Health and Discovery**:
- `mcp__postgres-mcp__list_schemas`: Discover database structure
- `mcp__postgres-mcp__list_objects`: Find tables, views, sequences
- `mcp__postgres-mcp__get_object_details`: Table schema, constraints, indexes
- `mcp__postgres-mcp__analyze_db_health`: Comprehensive health check

**Performance Analysis**:
- `mcp__postgres-mcp__get_top_queries`: Find slowest queries (pg_stat_statements)
- `mcp__postgres-mcp__explain_query`: Query execution plans
  - Supports hypothetical indexes for testing
- `mcp__postgres-mcp__analyze_workload_indexes`: Automated index recommendations
- `mcp__postgres-mcp__analyze_query_indexes`: Analyze specific queries (up to 10)

**Execution**:
- `mcp__postgres-mcp__execute_sql`: Run SQL (DDL/DML)
  - **ALWAYS confirm with user first**
  - Read-only mode available via access restrictions

## Example Interactions

### Example 1: Slow Query Optimization

**User**: "My query to find users by email is very slow"

**Skill Response**:
```
🔍 Searching memory for similar patterns...

Found: Query optimization for large tables (Memory 986e5336e7d85ba4, 67.7% match)
- Pattern: Text search on large tables benefits from pattern-specific indexes
- Success: text_pattern_ops for LIKE queries, reverse indexes for suffix matching
- Performance: 100M row table, 6 queries/second with proper indexing

🔧 Analyzing current database state...

[Uses analyze_db_health]
Database Health:
✓ Buffer cache hit rate: 92.4%
⚠ users table: 2.3M rows, 45% bloat
✗ No index on email column

[Uses explain_query]
Current query plan:
Seq Scan on users  (cost=0.00..15234.00 rows=1)
  Filter: (email = 'user@example.com')
Execution Time: 234.567 ms

💡 Recommendation:

Based on similar optimization (memory 986e5336):
1. CREATE INDEX idx_users_email ON users(email);
   - Expected: Seq Scan → Index Scan
   - Estimated improvement: 234ms → ~2ms (99%)

2. VACUUM ANALYZE users;
   - Reduce table bloat (45% → ~5%)
   - Update query planner statistics

Testing with hypothetical index...
[Uses explain_query with hypothetical index]
With index: Index Scan, cost 8.44..12.46, time: 2.3ms ✓

Proceed with optimization?
```

**After user confirms**:
```
[Uses execute_sql to create index]
✓ Index created: idx_users_email

[Uses explain_query to verify]
✓ Query plan changed: Index Scan now used
✓ Execution time: 2.1ms (99.1% improvement)

📝 Storing optimization in memory...
[Uses store-dev-memory with complete details]
✓ Stored as decision memory with tags: postgresql, indexing, performance, email-search
```

### Example 2: Database Health Check

**User**: "Check the health of my PostgreSQL database"

**Skill Response**:
```
🔍 Checking memory for past health baselines...

Found: PostgreSQL health baseline (Memory a324c1fa, 63.1% match)
- Previous buffer cache hit rate: 92%
- Aiven managed instance with pgvector
- Good: No vacuum issues, proper SSL configuration

🔧 Running current health analysis...

[Uses analyze_db_health]

Database Health Report:

✓ GOOD:
- Buffer cache hit rate: 94.2% (above 90% threshold)
- Connection health: 15/100 connections used
- All constraints valid
- Autovacuum configured properly

⚠ WARNINGS:
- Table bloat: users (45%), orders (32%)
- Unused indexes: idx_old_timestamp (0 scans in 30 days)
- Sequence limit: user_id_seq at 72% capacity

✗ ISSUES:
- pg_stat_statements not enabled (can't analyze query performance)

💡 Recommendations:

1. Enable pg_stat_statements for query analysis:
   ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
   (Requires PostgreSQL restart)

2. VACUUM ANALYZE users, orders tables (reduce bloat)

3. Consider dropping unused index:
   DROP INDEX idx_old_timestamp;
   (Would free ~127MB disk space)

4. Monitor user_id_seq - approaching 72% of BIGINT limit
   (No immediate action needed, but worth tracking)

Would you like me to generate SQL for any of these actions?
```

### Example 3: Learning from Failure

**User**: "That index didn't help, the query is still slow"

**Skill Response**:
```
🔍 Investigating why the optimization didn't work...

[Uses explain_query on the actual query]

Analysis:
- Index idx_users_email exists but NOT being used
- Query plan shows: Seq Scan (not Index Scan)
- Reason: Query uses ILIKE (case-insensitive), index is case-sensitive

📚 Checking memory for case-insensitive indexing patterns...

Found: Text pattern indexing (Memory 986e5336)
- For LIKE/ILIKE queries, need text_pattern_ops or specialized index
- Solution: Use functional index or trigram index

💡 Corrected Recommendation:

For case-insensitive email search, need different index:

Option 1 - Functional index (best for exact matches):
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
-- Query must use: WHERE LOWER(email) = LOWER('user@example.com')

Option 2 - Trigram index (best for partial matches):
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_email_trgm ON users USING gin(email gin_trgm_ops);
-- Supports: WHERE email ILIKE '%pattern%'

Which approach fits your query pattern better?

📝 I'll document this learning: "Standard btree index doesn't help ILIKE queries"
```

## Success Criteria

The skill is successful when:

1. **Memory is leveraged**: Every optimization references past patterns
2. **Safety is maintained**: No destructive operations without confirmation
3. **Knowledge grows**: Every optimization is documented for future use
4. **Results are verified**: Before/after metrics confirm improvements
5. **User understands**: Clear explanations of why recommendations work

## Common PostgreSQL Patterns to Remember

These patterns should be stored in memory over time:

1. **Text Search**: text_pattern_ops for LIKE, GIN/trigram for full-text
2. **JSONB**: GIN indexes for containment (@>, ?), btree for specific keys
3. **Large Tables**: Partial indexes, BRIN for time-series data
4. **High Write Volume**: Fewer indexes, consider FILLFACTOR
5. **Vacuum Strategy**: Autovacuum tuning, VACUUM ANALYZE after bulk ops
6. **Connection Pooling**: PgBouncer for many connections
7. **Query Planning**: ANALYZE tables, adjust statistics targets
8. **Index Maintenance**: Monitor bloat, rebuild when >30% bloated

## Notes for Skill Evolution

As this skill is used, collect data on:
- Which postgres-mcp tools are most useful in practice
- What memory search patterns find relevant results
- What optimization patterns repeat frequently
- What safety checks should be added
- What documentation format is most useful

Update this skill based on real-world usage and feedback.
