# TDD-INTEGRATED REFACTORING PLAN: MCP Memory System

## 🎯 OVERVIEW

**Project**: MCP Long-Term Memory System with PostgreSQL  
**Goal**: Eliminate technical debt through test-driven refactoring  
**Approach**: RED → GREEN → REFACTOR cycles with zero regressions  
**Timeline**: 4 phases over 4 weeks  
**Current State**: v0.2.0 with identified code duplication and architectural issues  

## 📊 CURRENT CODE ANALYSIS FINDINGS

### Critical Issues Identified
- **Error Handling Duplication**: 33+ identical patterns (`error instanceof Error ? error.message : String(error)`)
- **Monolithic File**: `src/index.ts` is 38,477 characters (should be <15K)  
- **Database Query Duplication**: Repeated SQL strings across multiple files
- **Test Structure Duplication**: Repeated setup/teardown patterns in test files
- **Missing Unit Tests**: Current coverage ~30%, target 80%+

### Architectural Assessment
**✅ Strengths**: Database adapter pattern, shared storage function, comprehensive TypeScript typing  
**❌ Weaknesses**: Monolithic structure, scattered configuration, inconsistent error handling

## 🧪 TDD METHODOLOGY

### Core Principle: Test-First Development
1. **RED**: Write failing tests that define desired behavior
2. **GREEN**: Implement minimum code to make tests pass
3. **REFACTOR**: Improve code structure while tests ensure no regressions
4. **VERIFY**: Run full test suite after each change

### Continuous Validation Commands
```bash
npm test                    # Unit tests
npm run test:integration   # Integration tests  
npm run test:contract      # Contract tests
npm run build              # TypeScript compilation
```

### Safety Net Strategy
- Existing integration tests act as regression protection
- Each refactoring step is atomic (1-3 files maximum)
- API contracts maintained throughout process
- Rollback plan: revert single commits if tests fail

---

## 📋 PHASE 1: ERROR HANDLING UTILITY (Week 1)

### Current Problem
**33+ duplicated error handling patterns** across all MCP tools:
```typescript
// Repeated everywhere:
const errorMessage = error instanceof Error ? error.message : String(error);
return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${errorMessage}` }]
};
```

### Step 1.1: Write Tests First (RED)
**File**: `tests/utils/error-response.test.ts`
```typescript
import { createErrorResponse } from '../../src/utils/error-response';

describe('createErrorResponse', () => {
  it('should handle Error objects correctly', () => {
    const error = new Error('Test error');
    const result = createErrorResponse(error, 'test-context');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Test error');
  });

  it('should handle string errors', () => {
    const error = 'String error message';
    const result = createErrorResponse(error, 'test-context');
    expect(result.content[0].text).toContain('String error message');
  });

  it('should handle unknown error types', () => {
    const error = { unknown: 'object' };
    const result = createErrorResponse(error, 'test-context');
    expect(result.content[0].text).toContain('[object Object]');
  });

  it('should include context in error messages', () => {
    const error = new Error('Test');
    const result = createErrorResponse(error, 'memory-storage');
    expect(result.content[0].text).toContain('memory-storage');
  });

  it('should return proper MCP response format', () => {
    const error = new Error('Test');
    const result = createErrorResponse(error, 'test');
    expect(result).toHaveProperty('isError', true);
    expect(result).toHaveProperty('content');
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
  });
});
```

### Step 1.2: Implement Utility (GREEN)
**File**: `src/utils/error-response.ts`
```typescript
export interface MCPErrorResponse {
  isError: true;
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

export function createErrorResponse(
  error: unknown, 
  context: string
): MCPErrorResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `Error in ${context}: ${errorMessage}`
    }]
  };
}
```

### Step 1.3: Refactor Call Sites (REFACTOR)
**Target Files** (33+ locations):
- `src/index.ts` - All MCP tool handlers
- Test files with error handling patterns

**Refactoring Process**:
1. Import `createErrorResponse` in `src/index.ts`
2. Replace each error handling block one by one:
   ```typescript
   // OLD:
   const errorMessage = error instanceof Error ? error.message : String(error);
   return {
       isError: true,
       content: [{ type: 'text', text: `Error: ${errorMessage}` }]
   };
   
   // NEW:
   return createErrorResponse(error, 'memory-overview');
   ```
3. Run tests after each replacement
4. Update any tools with custom error messages to use context parameter

### Success Criteria Phase 1
- [ ] All error handling tests pass
- [ ] Zero `error instanceof Error ? error.message : String(error)` patterns in codebase
- [ ] All existing integration tests still pass
- [ ] Build succeeds without TypeScript errors
- [ ] Consistent error message format across all MCP tools

---

## 📋 PHASE 2: MCP TOOL MODULARIZATION (Week 2)

### Current Problem
**Monolithic `src/index.ts`** (38,477 characters) contains all MCP tool definitions:
- 10+ tool handlers in single file
- Violates single responsibility principle
- Difficult to test individual tools
- Hard to maintain and understand

### Step 2.1: Write Module Tests First (RED)
**Files**: `tests/tools/memory-overview.test.ts`, `tests/tools/store-dev-memory.test.ts`, etc.

```typescript
// tests/tools/memory-overview.test.ts
import { MemoryOverviewTool } from '../../src/tools/memory-overview';
import { createMockDbService } from '../support/mock-db-service';

describe('MemoryOverviewTool', () => {
  let tool: MemoryOverviewTool;
  let mockDb: MockDbService;

  beforeEach(() => {
    mockDb = createMockDbService();
    tool = new MemoryOverviewTool(mockDb);
  });

  it('should return overview without database connection', async () => {
    mockDb.getDevMemories.mockResolvedValue([]);
    const result = await tool.handle({});
    expect(result.content[0].text).toContain('Memory System Overview');
  });

  it('should handle database errors gracefully', async () => {
    mockDb.getDevMemories.mockRejectedValue(new Error('DB Error'));
    const result = await tool.handle({});
    expect(result.isError).toBe(true);
  });

  it('should format response correctly', async () => {
    const memories = [createTestMemory()];
    mockDb.getDevMemories.mockResolvedValue(memories);
    const result = await tool.handle({});
    expect(result.content[0].text).toContain('Recent Memories Preview');
  });
});
```

### Step 2.2: Extract Tool Classes (GREEN)
**Directory Structure**:
```
src/tools/
├── base-tool.ts              # Abstract base class
├── memory-overview.ts         # Overview tool
├── store-dev-memory.ts        # Storage tool  
├── quick-store.ts             # Quick storage tool
├── get-recent-context.ts      # Recent context tool
├── list-dev-memories.ts       # List tool
├── get-dev-memory.ts          # Get single memory tool
├── search.ts                  # Basic search tool
├── search-enhanced.ts         # Advanced search tool
├── get-all-tags.ts            # Tag listing tool
├── list-memories-by-tag.ts    # Tag filtering tool
└── index.ts                   # Tool registry
```

**Base Class**:
```typescript
// src/tools/base-tool.ts
import { DatabaseService } from '../db/service';
import { MCPErrorResponse, createErrorResponse } from '../utils/error-response';

export interface MCPResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export abstract class BaseMCPTool<TParams = any> {
  constructor(protected dbService: DatabaseService) {}

  abstract handle(params: TParams): Promise<MCPResponse>;

  protected handleError(error: unknown, context: string): MCPErrorResponse {
    return createErrorResponse(error, context);
  }
}
```

**Example Tool Class**:
```typescript
// src/tools/memory-overview.ts
import { BaseMCPTool, MCPResponse } from './base-tool';
import { formatHashForDisplay } from '../utils/hash';

export class MemoryOverviewTool extends BaseMCPTool {
  async handle(): Promise<MCPResponse> {
    try {
      const recentMemories = await this.dbService.getDevMemories(5);
      const totalMemories = await this.dbService.getMemoryCount();
      
      const overview = {
        "🧠 Memory System Overview": {
          database: "PostgreSQL with pgvector for semantic search",
          total_memories: totalMemories,
          connection: "SSH tunnel to snowl/snowball",
          id_system: "Hash-based IDs (64-bit) for distributed uniqueness"
        },
        // ... rest of overview structure
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(overview, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, 'memory-overview');
    }
  }
}
```

### Step 2.3: Refactor index.ts (REFACTOR)
**Updated `src/index.ts`**:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Import tool classes
import { MemoryOverviewTool } from './tools/memory-overview';
import { StoreDevMemoryTool } from './tools/store-dev-memory';
// ... other imports

// Tool registry
const tools = {
  'memory-overview': new MemoryOverviewTool(dbService),
  'store-dev-memory': new StoreDevMemoryTool(dbService),
  // ... other tools
};

// Register tools with server
server.tool('memory-overview', 'Get overview...', {}, async (params) => {
  return tools['memory-overview'].handle(params);
});

server.tool('store-dev-memory', 'Store memory...', schemas.storeDevMemory, async (params) => {
  return tools['store-dev-memory'].handle(params);
});
```

### Success Criteria Phase 2
- [ ] All tool classes have comprehensive unit tests
- [ ] `src/index.ts` reduced from 38K to <15K characters
- [ ] Each tool can be tested in isolation with mocked dependencies
- [ ] All existing MCP tool functionality preserved
- [ ] Build succeeds and integration tests pass

---

## 📋 PHASE 3: QUERY CENTRALIZATION (Week 3)

### Current Problem
**Hardcoded SQL strings** scattered throughout codebase:
- Extension checks: `SELECT * FROM pg_extension WHERE extname = 'vector'` (3+ locations)
- Project lookups: `SELECT project_id FROM projects WHERE name = ?` (4+ locations)  
- Memory retrieval: `SELECT * FROM memories WHERE memory_id = ?` (multiple adapters)

### Step 3.1: Write Query Tests First (RED)
**File**: `tests/db/queries.test.ts`
```typescript
import { DatabaseQueries, QueryBuilder } from '../../src/db/queries';

describe('DatabaseQueries', () => {
  describe('Static Queries', () => {
    it('should have correct extension check query', () => {
      expect(DatabaseQueries.CHECK_EXTENSION).toBe(
        'SELECT extversion FROM pg_extension WHERE extname = $1'
      );
    });

    it('should have parameterized project lookup', () => {
      expect(DatabaseQueries.GET_PROJECT).toBe(
        'SELECT project_id, name, description FROM projects WHERE name = $1'
      );
    });
  });

  describe('QueryBuilder', () => {
    it('should generate correct extension check', () => {
      const query = QueryBuilder.checkExtension('vector');
      expect(query.sql).toBe(DatabaseQueries.CHECK_EXTENSION);
      expect(query.params).toEqual(['vector']);
    });

    it('should handle SQL injection safely', () => {
      const malicious = "'; DROP TABLE projects; --";
      const query = QueryBuilder.getProject(malicious);
      expect(query.params).toEqual([malicious]); // Parameterized, safe
    });

    it('should support different SQL dialects', () => {
      const pgQuery = QueryBuilder.getMemory('test', 'postgresql');
      const sqliteQuery = QueryBuilder.getMemory('test', 'sqlite');
      expect(pgQuery.sql).toContain('$1');
      expect(sqliteQuery.sql).toContain('?');
    });
  });
});
```

### Step 3.2: Create Query Builder (GREEN)
**File**: `src/db/queries.ts`
```typescript
export interface QuerySpec {
  sql: string;
  params: any[];
}

export const DatabaseQueries = {
  // Extension queries
  CHECK_EXTENSION: 'SELECT extversion FROM pg_extension WHERE extname = $1',
  
  // Project queries  
  GET_PROJECT: 'SELECT project_id, name, description FROM projects WHERE name = $1',
  CREATE_PROJECT: 'INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING project_id',
  
  // Memory queries
  GET_MEMORY: 'SELECT * FROM memories WHERE memory_id = $1',
  LIST_MEMORIES: 'SELECT * FROM memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
  CREATE_MEMORY: `INSERT INTO memories (memory_id, project_id, content, content_type, metadata, embedding) 
                   VALUES ($1, $2, $3, $4, $5, $6) RETURNING memory_id`,
  
  // Tag queries
  GET_ALL_TAGS: 'SELECT DISTINCT name FROM tags ORDER BY name',
  GET_TAG_BY_NAME: 'SELECT tag_id FROM tags WHERE name = $1',
  CREATE_TAG: 'INSERT INTO tags (tag_id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
  
  // Memory-tag relationship queries
  LINK_MEMORY_TAG: 'INSERT INTO memory_tags (memory_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
  GET_MEMORIES_BY_TAG: `SELECT m.* FROM memories m 
                        JOIN memory_tags mt ON m.memory_id = mt.memory_id 
                        JOIN tags t ON mt.tag_id = t.tag_id 
                        WHERE t.name = $1 LIMIT $2`
} as const;

export class QueryBuilder {
  static checkExtension(name: string): QuerySpec {
    return {
      sql: DatabaseQueries.CHECK_EXTENSION,
      params: [name]
    };
  }

  static getProject(name: string): QuerySpec {
    return {
      sql: DatabaseQueries.GET_PROJECT, 
      params: [name]
    };
  }

  static getMemory(memoryId: string, dialect: 'postgresql' | 'sqlite' = 'postgresql'): QuerySpec {
    const sql = dialect === 'postgresql' 
      ? DatabaseQueries.GET_MEMORY 
      : DatabaseQueries.GET_MEMORY.replace('$1', '?');
    
    return {
      sql,
      params: [memoryId]
    };
  }

  static listMemories(projectId: number, limit: number): QuerySpec {
    return {
      sql: DatabaseQueries.LIST_MEMORIES,
      params: [projectId, limit]
    };
  }

  static getMemoriesByTag(tagName: string, limit: number): QuerySpec {
    return {
      sql: DatabaseQueries.GET_MEMORIES_BY_TAG,
      params: [tagName, limit]
    };
  }
}
```

### Step 3.3: Refactor Database Adapters (REFACTOR)
**Update Files**:
- `src/db/adapters/postgres.ts`
- `src/db/adapters/sqlite.ts`

**Example Refactoring**:
```typescript
// OLD in postgres.ts:
const extensionCheck = await client.query(`
  SELECT extversion FROM pg_extension WHERE extname = 'vector'
`);

// NEW:
import { QueryBuilder } from '../queries';
const query = QueryBuilder.checkExtension('vector');
const extensionCheck = await client.query(query.sql, query.params);
```

### Success Criteria Phase 3
- [ ] All hardcoded SQL strings replaced with query constants
- [ ] Query builder tests pass with 100% coverage
- [ ] Both PostgreSQL and SQLite adapters use centralized queries
- [ ] No SQL injection vulnerabilities (parameterized queries only)
- [ ] Database adapter tests still pass

---

## 📋 PHASE 4: TEST INFRASTRUCTURE (Week 4)

### Current Problem
**Duplicated test setup/teardown** across multiple test files:
- Similar database initialization patterns
- Repeated mock creation logic  
- Inconsistent test structure
- Missing edge case coverage

### Step 4.1: Design Base Test Classes (RED)
**Files**: `tests/support/base-test.ts`, `tests/support/mcp-tool-test.ts`

```typescript
// tests/support/database-test-base.ts
import { DatabaseService } from '../../src/db/service';
import { PostgresAdapter } from '../../src/db/adapters/postgres';

export abstract class DatabaseTestBase {
  protected db: DatabaseService;
  protected adapter: PostgresAdapter;

  async setup(): Promise<void> {
    // Create test database connection
    this.adapter = new PostgresAdapter(getTestConfig());
    await this.adapter.connect();
    this.db = new DatabaseService(this.adapter);
    
    // Clean test data
    await this.cleanTestData();
  }

  async teardown(): Promise<void> {
    await this.cleanTestData();
    await this.adapter.disconnect();
  }

  protected async cleanTestData(): Promise<void> {
    // Remove test memories, tags, etc.
  }

  protected createTestMemory(overrides: Partial<Memory> = {}): Memory {
    return {
      memory_id: 'test-memory-id',
      project_id: 1,
      content: 'Test memory content',
      content_type: 'code',
      ...overrides
    };
  }

  protected createTestTag(name: string): Tag {
    return {
      tag_id: generateTagHash(name),
      name: name
    };
  }
}
```

```typescript
// tests/support/mcp-tool-test-base.ts
import { BaseMCPTool, MCPResponse } from '../../src/tools/base-tool';
import { DatabaseService } from '../../src/db/service';

export abstract class MCPToolTestBase<T extends BaseMCPTool> {
  protected tool: T;
  protected mockDb: jest.MockedObject<DatabaseService>;

  async setupMocks(): Promise<void> {
    this.mockDb = {
      getDevMemories: jest.fn(),
      storeMemory: jest.fn(),
      addMemoryTags: jest.fn(),
      searchMemories: jest.fn(),
      // ... other method mocks
    } as jest.MockedObject<DatabaseService>;
  }

  protected expectSuccessResponse(result: MCPResponse): void {
    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content[0]).toHaveProperty('type', 'text');
  }

  protected expectErrorResponse(result: MCPResponse, errorText?: string): void {
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
    if (errorText) {
      expect(result.content[0].text).toContain(errorText);
    }
  }

  protected createMockMemories(count: number): any[] {
    return Array.from({ length: count }, (_, i) => ({
      memory_id: `test-id-${i}`,
      content: `Test memory ${i}`,
      content_type: 'code',
      created_at: new Date().toISOString()
    }));
  }
}
```

### Step 4.2: Refactor Existing Tests (REFACTOR)
**Convert test files to use base classes**:

```typescript
// tests/tools/memory-overview.test.ts - REFACTORED
import { MemoryOverviewTool } from '../../src/tools/memory-overview';
import { MCPToolTestBase } from '../support/mcp-tool-test-base';

class MemoryOverviewTestSuite extends MCPToolTestBase<MemoryOverviewTool> {
  async setup(): Promise<void> {
    await this.setupMocks();
    this.tool = new MemoryOverviewTool(this.mockDb);
  }
}

describe('MemoryOverviewTool', () => {
  let suite: MemoryOverviewTestSuite;

  beforeEach(async () => {
    suite = new MemoryOverviewTestSuite();
    await suite.setup();
  });

  it('should return overview with memory count', async () => {
    const mockMemories = suite.createMockMemories(5);
    suite.mockDb.getDevMemories.mockResolvedValue(mockMemories);
    
    const result = await suite.tool.handle({});
    
    suite.expectSuccessResponse(result);
    expect(result.content[0].text).toContain('total_memories');
  });
});
```

### Step 4.3: Add Missing Test Coverage (GREEN)
**New Test Categories**:

1. **Edge Case Tests**:
   ```typescript
   // tests/edge-cases/
   ├── invalid-inputs.test.ts        # Malformed data handling
   ├── boundary-conditions.test.ts   # Large datasets, empty results
   ├── error-scenarios.test.ts       # Network failures, DB errors
   └── concurrent-access.test.ts     # Race conditions, locking
   ```

2. **Performance Tests**:
   ```typescript
   // tests/performance/
   ├── large-dataset.test.ts         # 10K+ memories
   ├── concurrent-operations.test.ts # Multiple simultaneous requests
   ├── memory-usage.test.ts          # Memory leak detection
   └── query-performance.test.ts     # SQL query optimization
   ```

3. **Integration Tests**:
   ```typescript
   // tests/integration/
   ├── end-to-end.test.ts           # Full MCP workflow
   ├── database-migration.test.ts   # Schema changes
   ├── backup-restore.test.ts       # Data persistence
   └── multi-tool-workflow.test.ts  # Tool interaction scenarios
   ```

### Success Criteria Phase 4
- [ ] All test files use base classes (no duplicated setup/teardown)
- [ ] Test coverage reaches 80%+ (currently ~30%)
- [ ] Edge cases and error scenarios covered
- [ ] Performance tests validate system under load
- [ ] Test execution time <30 seconds for full suite
- [ ] Integration tests cover end-to-end workflows

---

## 🎯 SUCCESS METRICS & VALIDATION

### Coverage Targets
- **Unit Test Coverage**: 80%+ (from current ~30%)
- **Integration Test Coverage**: 95%+ (from current ~70%)
- **Critical Path Coverage**: 100% (all MCP tools, database operations)

### Quality Metrics
- **Code Duplication**: Zero identical error handling patterns
- **File Size**: `src/index.ts` < 15K characters (from 38K)
- **Cyclomatic Complexity**: <10 per function
- **Build Time**: <2 minutes for full build + test cycle
- **Test Execution**: <30 seconds for complete test suite

### Regression Prevention
- **API Compatibility**: All existing MCP tool interfaces preserved
- **Data Integrity**: Database operations produce identical results
- **Performance**: No degradation in response times
- **Error Handling**: Consistent error message format across all tools

### Documentation Requirements
- [ ] Update README with new architecture
- [ ] Document test patterns and base classes
- [ ] Create developer guide for adding new tools
- [ ] Update API documentation with examples

---

## 🚀 IMPLEMENTATION CHECKLIST

### Phase 1: Error Handling Utility
- [ ] Write comprehensive error response tests
- [ ] Implement `createErrorResponse()` utility function
- [ ] Refactor all 33+ error handling call sites
- [ ] Verify zero regression in error behavior
- [ ] Update any custom error messages to use context parameter

### Phase 2: Tool Modularization  
- [ ] Create base tool class with common functionality
- [ ] Write unit tests for each individual tool
- [ ] Extract 10+ tool classes from `src/index.ts`
- [ ] Create tool registry system
- [ ] Verify `src/index.ts` is <15K characters
- [ ] Ensure all tools can be tested in isolation

### Phase 3: Query Centralization
- [ ] Design query builder with dialect support
- [ ] Write comprehensive query tests including SQL injection prevention
- [ ] Extract all hardcoded SQL to query constants
- [ ] Refactor PostgreSQL and SQLite adapters
- [ ] Verify query results are identical to previous implementation
- [ ] Add query performance benchmarks

### Phase 4: Test Infrastructure
- [ ] Create database test base class with cleanup utilities
- [ ] Create MCP tool test base class with mock helpers
- [ ] Refactor existing tests to eliminate duplication
- [ ] Add edge case and error scenario tests
- [ ] Implement performance test suite
- [ ] Achieve 80%+ overall test coverage
- [ ] Document testing patterns and guidelines

### Final Validation
- [ ] All existing integration tests pass
- [ ] New unit tests achieve target coverage
- [ ] Performance benchmarks meet requirements
- [ ] Documentation updated and complete
- [ ] Code review completed with team approval
- [ ] Ready for deployment to production

---

## 🔄 ROLLBACK PLAN

### If Phase Fails
1. **Immediate Rollback**: Revert last commit using `git reset --hard HEAD~1`
2. **Verify Stability**: Run full test suite to ensure system works
3. **Analyze Failure**: Examine test failures and code issues
4. **Adjust Approach**: Modify implementation strategy
5. **Retry**: Attempt phase again with lessons learned

### Emergency Rollback
- **Complete Rollback**: Reset to v0.2.0 tag if major issues occur
- **Hotfix Branch**: Create separate branch for critical bug fixes
- **Communication**: Notify team of rollback and estimated recovery time

### Success Criteria for Continuation
- All existing tests pass
- New tests provide expected coverage
- Build succeeds without errors
- No performance degradation observed

---

**Author**: PB and Claude  
**Created**: 2025-07-04  
**Status**: Planning Phase  
**Next Action**: Begin Phase 1 - Error Handling Utility TDD Implementation