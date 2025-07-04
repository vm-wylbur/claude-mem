# Memory System Performance Baseline

## Test Environment
- **Date**: July 1, 2025, 13:11 PDT  
- **System**: macOS (pball's laptop)
- **Database**: SQLite at `/Users/pball/.local/share/mcp-memory/memory.db`
- **Memory Count**: 54 total memories
- **Embeddings**: 34 vectors (768-dimensional, nomic-embed-text)
- **Database Size**: 356KB (~6.6KB per memory average)

## SQLite Performance Results

### Basic Operations
- **Memory Listing**: 4-5ms overhead per MCP call
- **Individual Memory Retrieval**: Near-instantaneous 
- **Search Operations**: Fast response, no noticeable delays
- **Storage**: Successful, no errors observed

### Search Performance Tests
**Test Query**: "PostgreSQL" 
- **Results**: 5 relevant memories found
- **Top Match**: 53.3% similarity 
- **Response**: Immediate, no lag

**Test Query**: "ZFS"
- **Results**: 5 memories returned (though lower relevance)
- **Top Match**: 34.0% similarity
- **Response**: Immediate

**Test Query**: "database performance"  
- **Results**: 5 highly relevant memories
- **Top Match**: 53.8% similarity
- **Notable**: Found exact matches AND semantically related content

### Stress Testing
- **Rapid-fire searches**: No performance degradation observed
- **Concurrent access**: No database locks or conflicts
- **Multiple MCP operations**: Stable throughout testing

### Database Analysis
```sql
-- Memory count by type
SELECT content_type, COUNT(*) FROM memories GROUP BY content_type;
-- Results: decision, conversation, code, reference types present

-- Embedding distribution  
SELECT COUNT(*) as memories_with_embeddings FROM memories WHERE embedding_id IS NOT NULL;
-- Results: 34/54 memories have embeddings (63%)
```

## Architecture Notes
- **Embedding Storage**: BLOB format in SQLite
- **Similarity Calculation**: In-memory JavaScript cosine similarity
- **Concurrent Access**: SQLite handling multiple Claude instances well
- **Memory Persistence**: Perfect - no data loss during testing

## Baseline for PostgreSQL Comparison

### Expected PostgreSQL Improvements:
1. **Native vector operations** (pgvector `<->` operator vs in-memory calculation)
2. **Better concurrent access** (PostgreSQL vs SQLite locking)
3. **Network operations** (SSH tunnel latency vs local file access)
4. **Indexing performance** (PostgreSQL indexes vs SQLite simplicity)

### Key Metrics to Compare:
- [ ] Search response time (ms)
- [ ] Memory storage time (ms) 
- [ ] Concurrent operation handling
- [ ] Database size efficiency
- [ ] Network vs local access impact
- [ ] Vector similarity accuracy/performance

## Test Methodology for PostgreSQL
1. **Identical test queries** for direct comparison
2. **Same memory dataset** (54 memories)
3. **Multiple Claude instances** for concurrent testing
4. **SSH tunnel performance** (snowl vs snowball fallback)
5. **pgvector similarity** vs in-memory cosine similarity

---
*Baseline established by Claude instance testing while PostgreSQL migration was in progress by another Claude instance. Multi-Claude development! 🚀*
