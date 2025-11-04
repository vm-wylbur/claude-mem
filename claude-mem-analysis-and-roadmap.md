# Claude-Mem Analysis: Learning from Existing Memory & Workflow Systems

**Date**: November 3, 2025  
**Purpose**: Planning guide for integrating claude-mem with Claude Code workflows  
**Status**: Research-based recommendations for implementation

---

## Executive Summary

After reviewing 15+ implementations, three clear patterns emerge:

1. **MCP servers handle data** (storage, retrieval, semantic search)
2. **Workflow frameworks handle instructions** (CLAUDE.md, commands, memory-bank files)
3. **Skills/plugins handle orchestration** (when to check memory, what to log)

**Current State**: Your claude-mem is best-in-class for layer #1. You need to build layers #2 and #3.

**Key Finding**: No Claude Code Skills exist that integrate MCP memory workflows. You're pioneering this integration. The closest reference is Every's compounding-engineering, which uses text files instead of an MCP server.

---

## Table of Contents

1. [MCP Memory Servers: Data Storage Layer](#mcp-memory-servers-data-storage-layer)
2. [Workflow/Memory Bank Frameworks: Instruction Patterns](#workflowmemory-bank-frameworks-instruction-patterns)
3. [Skills/Plugins: Task Orchestration Layer](#skillsplugins-task-orchestration-layer)
4. [Integration Patterns](#integration-patterns-how-they-connect)
5. [Key Learnings Summary](#key-learnings-summary)
6. [Features to Add to claude-mem](#features-to-add-to-claude-mem)
7. [Skills to Build](#skills-to-build-in-order)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Critical Success Factors](#critical-success-factors)

---

## MCP Memory Servers: Data Storage Layer

### 1. doobidoo/mcp-memory-service ⭐ Most Comprehensive

**Repository**: https://github.com/doobidoo/mcp-memory-service

**What they got right:**

- **Natural language trigger detection** (85%+ accuracy on "remember that", "note:", "important:")
  - 3-tier system: keyword patterns (50ms) → semantic analysis (150ms) → deep extraction (500ms)
- **Hybrid backend**: SQLite-vec local (5ms reads) + Cloudflare sync for backup
- **Automatic consolidation**: Merges similar memories, importance scoring
- **Document ingestion**: PDF, TXT, MD, JSON, CSV support
- **OAuth 2.1** for team collaboration

**Production Metrics:**
- 1,700+ memories in production
- 65% token reduction in sessions
- <500ms semantic search
- Zero database locks with concurrent access

**Learn from them:**
- Their trigger detection system (study `src/utils/trigger_detection.py`)
- Consolidation algorithm for deduplication
- HTTP + OAuth for team access (HRDAG needs this)

**What you already do better:**
- 768d embeddings vs their lower dimensions
- Dev-specific memory types (Code, Decisions, References)
- Richer metadata for technical work

---

### 2. mcp-memory-keeper (Claude Code Specific)

**Repository**: https://github.com/mkreyman/mcp-memory-keeper

**What they got right:**

- **Git integration**: Auto-save context on commits, branch-aware channels
- **Session management**: Create, continue, branch sessions with checkpoints
- **File tracking**: SHA-256 hashing for change detection
- **Knowledge graph**: Entity/relationship extraction

**Tools provided:**
```typescript
mcp_context_session_start  // Initialize persistent session
mcp_context_save           // Store with categories (decision, task, progress, note)
mcp_context_get            // Retrieve by category, priority, time range
mcp_context_checkpoint     // Save complete state snapshot
mcp_context_search         // Semantic search
mcp_context_git_commit     // Auto-log on commit
```

**Learn from them:**
- Git integration pattern - critical for HRDAG work tracking
- Session checkpoint system for long-running projects
- Branch-aware memory (different context per feature branch)

---

### 3. Official @modelcontextprotocol/server-memory

**Repository**: https://github.com/modelcontextprotocol/servers/tree/main/src/memory

**What they got right:**

- **Knowledge graph model**: Entity-Relationship-Observation
- **JSONL format**: Human-readable, git-diffable
- **Simple, clear API**: create_entities, create_relations, add_observations, search_nodes

**Learn from them:**
- Their relationship model (simpler than yours, might be easier for Claude to use)
- JSONL as export format for human review
- Clear separation: entities vs observations vs relations

---

### 4. sdimitrov/mcp-memory

**Repository**: https://github.com/sdimitrov/mcp-memory

**Stack**: Node.js, Prisma ORM, PostgreSQL 14+, pgvector

**Technical capabilities:**
- **Vector search**: BERT embeddings (384 dimensions)
- **Semantic similarity**: Cosine distance for relevance
- **Tag-based organization**: Multiple tags per memory
- **Confidence scoring**: 0-1 scale for memory accuracy
- **RESTful API**: HTTP endpoints + Server-Sent Events

**Comparison to your implementation:**
- You use 768d embeddings (better semantic understanding)
- Similar PostgreSQL + pgvector stack
- You have richer dev-specific metadata

---

### 5. basicmachines-co/basic-memory

**Repository**: https://github.com/basicmachines-co/basic-memory

**What they got right:**

- **Markdown files** as storage (Obsidian integration)
- **Bidirectional sync** between Claude and files
- **Project-based isolation** with easy switching
- **Real-time sync** (no manual operations)

**Their workflow:**
```markdown
You: "Create a note about our authentication strategy"
Claude: [Creates structured note with technical details]

You: "Switch to my work project"
Claude: [Loads work project context]

You: "Based on our API design notes, what's the next step?"
Claude: [Uses loaded context to answer]
```

**Learn from them:**
- Project switching UX (you need this for multiple HRDAG projects)
- Markdown export for human readability
- Real-time sync philosophy (no manual save commands)

---

### 6. Other Working Implementations

**Puliczek/mcp-memory**  
Repository: https://github.com/Puliczek/mcp-memory  
Focus: User preferences and behaviors across conversations

**Synapse-OS/local-mem0-mcp**  
Focus: Self-hosted with Ollama (phi3:mini embeddings)

**coleam00/mcp-mem0**  
Repository: https://github.com/coleam00/mcp-mem0  
Focus: Template for custom MCP servers with Mem0

---

## Workflow/Memory Bank Frameworks: Instruction Patterns

### 7. RIPER-5 Workflow by Tony Narlock

**Repository**: https://github.com/tony/claude-code-riper-5

**What they got right:**

- **5-phase structured workflow**: Research → Innovate → Plan → Execute → Review
- **Memory Bank files** with explicit update commands
- **Branch-aware memory**: Different context per git branch
- **Strict mode enforcement**: Prevents Claude from skipping steps

**Their memory structure:**
```
.claude/
├── memory-bank/
│   ├── projectbrief.md      # High-level project context
│   ├── techstack.md          # Technology decisions
│   ├── architecture.md       # System design
│   ├── progress.md           # Current state
│   ├── decisions.md          # Key choices made
│   └── blockers.md           # Current issues
```

**Learn from them:**
- **Explicit phase transitions**: Forces memory checks at phase boundaries
- **Consolidated subagents**: Reduces context overhead
- **Memory update as workflow step**: `/workflow:update-memory` command

---

### 8. hudrazine/claude-code-memory-bank

**Repository**: https://github.com/hudrazine/claude-code-memory-bank

**What they got right:**

- **Adaptive initialization**: Detects existing project state, preserves docs
- **Custom slash commands**: `/workflow:understand`, `/workflow:plan`, `/workflow:execute`, `/workflow:update-memory`
- **Project intelligence**: Auto-detects technologies from package.json, README
- **Hierarchical documentation**: 6 core Memory Bank files that build on each other

**Their workflow pattern:**
```markdown
# First session
/init-memory-bank
# → Analyzes project, creates structure

# Later session
/workflow:understand
# → Reads memory bank, understands state

/workflow:plan "Add user authentication"
# → Creates plan based on existing context

/workflow:execute
# → Implements feature

/workflow:update-memory
# → Updates memory bank with progress
```

**Learn from them:**
- **Auto-detection** of project context (scan package.json, README, etc.)
- **Progressive disclosure**: Start small, expand memory bank as needed
- **Import pattern**: `@.claude/claude-memory-bank.md` in CLAUDE.md

---

### 9. vanzan01/cursor-memory-bank

**Repository**: https://github.com/vanzan01/cursor-memory-bank

**What they got right:**

- **Custom modes** for different phases (VAN, PLAN, CREATIVE, IMPLEMENT)
- **Shared memory** across mode transitions
- **Visual process maps**: Clear diagrams of workflow
- **Hierarchical rule loading**: Load only essential rules (token optimization)
- **Progressive documentation**: Scales with task complexity

**Token optimization approach:**
```markdown
Level 1 (Simple): Load 500 tokens of base rules
Level 2 (Medium): Add 1,000 tokens of specific guidance
Level 3 (Complex): Add 2,000 tokens of detailed examples
Level 4 (Expert): Full 4,000+ token knowledge base
```

**Learn from them:**
- **Progressive disclosure** based on task complexity
- **Mode transitions** preserve context (VAN → PLAN → IMPLEMENT)
- **Visual documentation** helps users understand workflow

---

### 10. centminmod/my-claude-code-setup

**Repository**: https://github.com/centminmod/my-claude-code-setup

**What they got right:**

- **Memory bank update command**: `/update-memory-bank` to sync CLAUDE.md
- **Specialized task delegation**: Convert verbose workflows to focused tasks
- **Context overflow prevention**: Max 5 files per task
- **Release documentation**: Auto-generate from commits with memory context

**Learn from them:**
- Simple **explicit memory update** command
- **File selection strategy** (prevents context bloat)
- **Commit-to-memory pipeline** for documentation

---

### 11. johnpeterman72/cursor_memory_riper_framework

**Repository**: https://github.com/johnpeterman72/cursor_memory_riper_framework

**What they got right:**

- START phase for project initialization
- Memory Bank initialization as part of scaffolding
- Comprehensive system to "temper Claude 3.7's over-enthusiasm"

**Learn from them:**
- Project initialization with memory setup
- Preprocessing phase pattern

---

### 12. alioshr/memory-bank-mcp

**Repository**: https://github.com/alioshr/memory-bank-mcp

**What they got right:**

- Remote memory bank management via MCP
- Custom instructions for multiple AI clients (Cline, Claude, Cursor)
- Docker deployment support

**Learn from them:**
- Multi-client compatibility patterns
- Docker containerization for team deployment

---

## Skills/Plugins: Task Orchestration Layer

### 13. EveryInc/every-marketplace - compounding-engineering ⭐ YOUR TEMPLATE

**Repository**: https://github.com/EveryInc/every-marketplace

**What they got right - THIS IS YOUR MODEL:**

**Three-command pattern:**

1. **/compounding-engineering:plan** - Research then create
   - Researches codebase for similar patterns
   - Analyzes framework docs
   - Creates comprehensive issues with examples
   
2. **/compounding-engineering:work** - Execute with memory
   - Creates isolated worktrees
   - Breaks down into trackable todos
   - Runs tests after each change
   - Uses established patterns
   
3. **/compounding-engineering:review** - Learn and document
   - Runs 12+ specialized review agents
   - Identifies patterns for future use
   - Creates todos for findings

**Their agents (you need equivalents):**
```markdown
Research agents:
- repo-research-analyst: Analyzes repository patterns
- git-history-analyzer: Analyzes git history for context
- framework-docs-researcher: Fetches relevant framework docs
- best-practices-researcher: Researches best practices

Review agents:
- pattern-recognition-specialist: Identifies patterns
- security-sentinel: Security audits
- performance-oracle: Performance analysis
- architecture-strategist: System design review
- data-integrity-guardian: Database design review
```

**Their philosophy:**
> "Each unit of engineering work should make subsequent units easier"  
> "Features document patterns for the next feature"  
> "Codifies knowledge that compounds across the team"

**Learn from them:**
- **Always research before implementing** (search your claude-mem first)
- **Multi-agent review** to extract learnings
- **Systematic workflow** with explicit phases
- **Pattern reuse** as core principle

**Critical insight**: They use text files in the repo. You're doing the same thing but with PostgreSQL + semantic search for better scalability and cross-project memory.

---

### 14. obra/superpowers

**Repository**: https://github.com/obra/superpowers

**What they got right:**

- **Automatic skill activation**: Skills trigger based on context
- **Marketplace distribution**: `/plugin marketplace add`
- **Battle-tested skills**: 20+ production skills (TDD, debugging, etc.)
- **Skill composition**: Multiple skills work together

**Their skills:**
```
- test-driven-development: Activates when implementing features
- systematic-debugging: Activates when debugging issues
- using-git-worktrees: Creates isolated environments
- finishing-a-development-branch: Completion workflows
```

**Learn from them:**
- **Auto-activation pattern** (no explicit /command needed)
- **Skill frontmatter design** for discovery
- **Marketplace distribution** model

---

### 15. ruvnet/claude-flow

**Repository**: https://github.com/ruvnet/claude-flow

**What they got right:**

- **25 auto-activating skills** via natural language
- **AgentDB integration**: 96x-164x faster vector search
- **Hybrid memory**: AgentDB + ReasoningBank with fallback
- **Semantic vector search** with HNSW indexing

**Memory commands:**
```bash
# Store with vector embedding
claude-flow memory store-vector api_design "REST endpoints" \
  --namespace backend --metadata '{"version":"v2"}'

# Semantic search
claude-flow memory vector-search "user authentication flow" \
  --k 10 --threshold 0.7 --namespace backend

# Pattern search (2-3ms latency)
claude-flow memory query "API config" --namespace backend
```

**Learn from them:**
- **Namespace-based isolation** (backend, frontend, infra)
- **Vector + pattern dual search** (semantic + exact match)
- **Performance metrics** (they publish real benchmarks)

---

### 16. ComposioHQ/awesome-claude-skills

**Repository**: https://github.com/ComposioHQ/awesome-claude-skills

**What they got right:**

- Curated list of working skills across platforms
- Skills work across Claude.ai, Claude Code, and API
- Skill portability emphasis

**Notable skills listed:**
- skill-creator: Interactive skill creation
- mcp-builder: Guide for creating MCP servers
- test-driven-development: TDD workflow enforcement
- using-git-worktrees: Isolated development environments

---

## Integration Patterns: How They Connect

### 17. Basic Memory + Claude Code Integration

**Documentation**: https://docs.basicmemory.com/integrations/claude-code/

**Their integration pattern:**
```markdown
# CLAUDE.md includes:
Before implementing:
- Check Basic Memory for relevant notes
- Review past decisions
- Load project context

After implementing:
- Document new patterns
- Update decision log
- Create cross-references
```

**Learn from them:**
- **CLAUDE.md as integration point**
- **Natural language memory operations** (no explicit tool calls in user prompts)
- **Project switching** within conversation

---

### 18. lukerf89/claude-basic-memory-workflow

**Repository**: https://github.com/lukerf89/claude-basic-memory-workflow

**Their collaboration pattern:**
```
Claude Desktop → Research topic → Create notes
↓
Claude Code → Read notes → Implement code
↓
Update memory → Document learnings
```

**Learn from them:**
- **Asynchronous collaboration**: Research in Desktop, implement in Code
- **Seamless handoffs** between interfaces
- **PARA method integration** with Obsidian

---

## Key Learnings Summary

### Architecture Decisions

**1. Three-Layer Architecture**
```
┌─────────────────────────────────────┐
│ Layer 3: Skills (Task Orchestration)│
│ - When to check memory               │
│ - What to log                        │
│ - Workflow phases                    │
├─────────────────────────────────────┤
│ Layer 2: Workflow (Instructions)    │
│ - CLAUDE.md                          │
│ - Command definitions                │
│ - Memory update patterns             │
├─────────────────────────────────────┤
│ Layer 1: MCP Server (Data)          │
│ - claude-mem (your existing)         │
│ - PostgreSQL + pgvector              │
│ - Semantic search                    │
└─────────────────────────────────────┘
```

**2. Memory Check Pattern** (from Every + RIPER)
```markdown
BEFORE action:
1. Search semantic patterns in claude-mem
2. Review tagged memories by category
3. Check recent context for session continuity

DURING action:
4. Apply retrieved patterns
5. Note new patterns discovered

AFTER action:
6. Store detailed memory with metadata
7. Link to related memories
8. Tag for future retrieval
```

**3. Progressive Disclosure** (from vanzan01 + hudrazine)
```
Simple tasks: Query recent context only (fast)
Medium tasks: Search + review tags (moderate)
Complex tasks: Deep semantic search + relationship traversal (thorough)
```

---

## Features to Add to claude-mem

### Priority 1: Core Integration (Essential)

**From doobidoo/mcp-memory-service:**
- [ ] Natural trigger detection ("remember that", "note:", "important:")
  - Implement 3-tier system: keyword (50ms) → semantic (150ms) → deep (500ms)
- [ ] Automatic consolidation (merge similar memories)
  - Similarity threshold for deduplication
  - Importance scoring algorithm
- [ ] Document ingestion (PDF, TXT, MD for your legacy docs)
  - Extract text from various formats
  - Maintain source references

**From mcp-memory-keeper:**
- [ ] Git integration (auto-save on commits)
  - Hook into git commit workflow
  - Store commit SHA with memory
  - Branch-aware context
- [ ] Session checkpoints
  - Save complete conversation state
  - Resume from checkpoint
- [ ] Branch-aware memory
  - Different context per git branch
  - Merge contexts on branch merge

### Priority 2: Workflow Support (Important)

**From Every + RIPER:**
- [ ] Memory query tools optimized for "search before implement"
  - Pattern matching API
  - "Similar to this" search
- [ ] Pattern matching API (find similar implementations)
  - Code similarity scoring
  - Architecture pattern detection
- [ ] Decision log query (retrieve past architectural choices)
  - Filter by decision type
  - Timeline view

**From basicmachines-co/basic-memory:**
- [ ] Project switching (HRDAG project A vs project B)
  - Multi-project configuration
  - Quick context switching
  - Project-specific memory isolation
- [ ] Markdown export (human-readable review)
  - Export all memories for project
  - Formatted for human reading
  - Obsidian-compatible format
- [ ] Real-time sync indicator
  - Show when memory is being saved
  - Confirm successful storage

### Priority 3: Team Features (Nice to Have)

**From doobidoo/mcp-memory-service:**
- [ ] OAuth 2.1 for HRDAG team collaboration
  - Team member authentication
  - Permission management
  - Shared vs private memories
- [ ] HTTP transport alongside stdio
  - REST API endpoints
  - Remote access support
- [ ] Web dashboard (port 8888)
  - Browse memories visually
  - Edit/delete interface
  - Search interface

### Priority 4: Performance & Usability

**From various sources:**
- [ ] Namespace-based isolation (backend, frontend, data-recovery, etc.)
- [ ] Confidence scoring for memories
- [ ] Memory aging/deprecation (mark old memories as outdated)
- [ ] Bulk import from lessons-learned markdown files
- [ ] Export to various formats (JSON, CSV, Markdown)

---

## Skills to Build (in order)

### Skill 1: `memory-augmented-dev` (Core - Build First)

**Pattern from**: Every's compounding-engineering + RIPER phases

**Purpose**: Ensure every development task leverages and contributes to memory

**File**: `.claude/skills/memory-augmented-dev/SKILL.md`

```yaml
---
name: memory-augmented-dev
description: Development with persistent memory checks and automatic logging
---

# Memory-Augmented Development

## Core Principle
Before implementing ANY feature, always search memory for relevant patterns.
After completing ANY work, always store learnings in memory.

## Workflow

### Phase 1: Research (Before Implementation)

1. **Semantic Search for Patterns**
   ```
   search-enhanced(
     query: "<feature area> implementation patterns",
     filters: {type: "code"}
   )
   ```

2. **Review Past Decisions**
   ```
   list-memories-by-tag(["<feature-area>", "architecture", "decisions"])
   ```

3. **Check Recent Context**
   ```
   get-recent-context(project: "<current-project>")
   ```

4. **Analyze Retrieved Memories**
   - What patterns were successful?
   - What mistakes were made?
   - What decisions inform this work?

### Phase 2: Implementation

5. **Apply Patterns Found**
   - Use established code patterns
   - Follow past architectural decisions
   - Avoid documented mistakes

6. **Note Deviations**
   - If deviating from patterns, document why
   - Prepare justification for memory storage

### Phase 3: Documentation (After Implementation)

7. **Store Memory with Rich Metadata**
   ```
   store-dev-memory({
     type: "code",
     content: "Detailed description of implementation",
     project: "<project-name>",
     tags: ["<feature>", "<technology>", "<pattern-used>"],
     metadata: {
       implementation_status: "complete",
       key_decisions: ["Decision 1", "Decision 2"],
       files_created: ["file1.py", "file2.py"],
       files_modified: ["existing.py"],
       code_changes: "Summary of major changes",
       dependencies_added: ["package1", "package2"],
       testing_notes: "How to test this"
     },
     relationships: [
       {
         memory_id: "<related-memory-hash>",
         type: "builds_on" | "supersedes" | "related_to"
       }
     ]
   })
   ```

8. **Store Decisions Separately**
   ```
   store-dev-memory({
     type: "decision",
     content: "Why we chose approach X over Y",
     project: "<project-name>",
     tags: ["decision", "<topic>"],
     metadata: {
       alternatives_considered: ["Approach Y", "Approach Z"],
       decision_rationale: "Explanation",
       decision_date: "<date>",
       who_decided: "<name>"
     }
   })
   ```

## Tool Reference

### search-enhanced
**Purpose**: Semantic search across all memories  
**Parameters**:
- `query` (string): Search terms
- `filters` (object): Optional filters
  - `type`: "code" | "decision" | "conversation" | "reference"
  - `tags`: Array of tags to match
  - `project`: Project name
  - `date_from`, `date_to`: Date range
- `limit` (int): Max results (default: 10)

**Returns**: Array of memories with similarity scores

### list-memories-by-tag
**Purpose**: Get all memories with specific tags  
**Parameters**:
- `tags` (array): Tags to search for
- `project` (string): Optional project filter

**Returns**: Array of memories

### get-recent-context
**Purpose**: Get recent memories for session continuity  
**Parameters**:
- `project` (string): Project name
- `limit` (int): Number of recent items (default: 10)

**Returns**: Array of recent memories, ordered by date

### store-dev-memory
**Purpose**: Store new memory with full metadata  
**Parameters**: (see Phase 3 examples above)

**Returns**: Memory ID (hash)

### get-dev-memory
**Purpose**: Retrieve specific memory by ID  
**Parameters**:
- `memory_id` (string): Memory hash ID

**Returns**: Full memory object

## Examples

### Example 1: Implementing Authentication

**Step 1: Research**
```
search-enhanced("authentication JWT patterns", filters={type: "code"})
list-memories-by-tag(["authentication", "security"])
```

**Result**: Found memory showing JWT implementation from 3 months ago

**Step 2: Implement**
Apply the JWT pattern found, using similar code structure

**Step 3: Document**
```
store-dev-memory({
  type: "code",
  content: "Implemented JWT authentication with refresh tokens for API v2",
  project: "hrdag-api",
  tags: ["authentication", "jwt", "security", "api-v2"],
  metadata: {
    implementation_status: "complete",
    key_decisions: [
      "Used JWT over session-based auth for stateless API",
      "Refresh token rotation every 7 days"
    ],
    files_created: ["auth/jwt_manager.py", "auth/middleware.py"],
    files_modified: ["api/routes.py", "config/settings.py"],
    dependencies_added: ["PyJWT==2.8.0"],
    testing_notes: "Test with curl scripts in tests/auth/"
  },
  relationships: [{
    memory_id: "<hash-of-3-month-old-auth-memory>",
    type: "builds_on"
  }]
})
```

### Example 2: Fixing Data Recovery Bug

**Step 1: Research**
```
search-enhanced("zip disk recovery errors", filters={type: "code"})
list-memories-by-tag(["data-recovery", "bugs", "zip-disk"])
```

**Result**: Found memory about ddrescue parameters and common failures

**Step 2: Implement**
Applied lessons about proper ddrescue flags and error handling

**Step 3: Document**
```
store-dev-memory({
  type: "code",
  content: "Fixed zip disk recovery by adjusting ddrescue retry parameters",
  project: "vintage-data-recovery",
  tags: ["data-recovery", "zip-disk", "bugfix", "ddrescue"],
  metadata: {
    implementation_status: "complete",
    key_decisions: [
      "Increased retry count from 3 to 10 for bad sectors",
      "Added sector size specification for old media"
    ],
    files_modified: ["recovery_scripts/zip_disk_reader.sh"],
    testing_notes: "Tested on 5 failing disks, 3 now readable"
  },
  relationships: [{
    memory_id: "<hash-of-ddrescue-lessons>",
    type: "applies"
  }]
})
```

## Anti-Patterns to Avoid

❌ **Don't skip research phase** - Always check memory first  
❌ **Don't forget to store learnings** - Every task generates knowledge  
❌ **Don't store generic descriptions** - Be specific about what was done  
❌ **Don't skip relationships** - Link to related memories  
❌ **Don't omit key decisions** - Future you needs to know why

## Success Metrics

- Every feature implementation references at least 1 past memory
- Every completed task stores at least 1 new memory
- Memory retrieval takes <500ms
- 90% of new implementations find relevant patterns in memory
```

---

### Skill 2: `lessons-learned-reviewer` (Your Specific Need)

**Pattern from**: Every's review agents + your existing markdown files

**Purpose**: Process your existing lessons-learned markdown files into structured memory

**File**: `.claude/skills/lessons-learned-reviewer/SKILL.md`

```yaml
---
name: lessons-learned-reviewer
description: Reviews lessons-learned markdown files and updates memory database
---

# Lessons Learned Reviewer

## Purpose
Convert ad-hoc lessons-learned markdown files into structured, searchable memories.

## Activation
Triggers when user:
- Mentions "lessons learned"
- References a "retrospective"
- Says "review learnings from"
- Points to a markdown file with lessons

## Workflow

### Step 1: Read the File
```
Read the lessons-learned markdown file provided by user
```

### Step 2: Extract Structured Information

For each lesson, identify:
- **Category**: What type of lesson? (technical, process, decision, mistake)
- **Context**: What project/feature/task?
- **Description**: What happened?
- **Outcome**: What was learned?
- **Action Items**: What should be done differently?

### Step 3: Check for Duplicates
```
For each extracted lesson:
  search-enhanced(
    query: "<lesson topic>",
    filters: {type: "decision" or "reference"}
  )
  
  If similar memory exists:
    Review both
    Decide: update existing or create new linked memory
  Else:
    Create new memory
```

### Step 4: Store Each Lesson
```
store-dev-memory({
  type: "decision" | "reference" | "conversation",
  content: "<detailed lesson description>",
  project: "<project-name>",
  tags: ["lessons-learned", "<category>", "<topic>"],
  metadata: {
    key_decisions: ["What we learned"],
    source_file: "<path-to-markdown-file>",
    date_learned: "<date>",
    context: "What we were doing when we learned this"
  },
  relationships: [
    // Link to related memories if found
  ]
})
```

### Step 5: Create Relationships

After storing all lessons, create relationships between related items:
```
For each newly stored memory:
  search-enhanced(query: "<related topics>")
  For each related memory found:
    Update relationships to link them
```

### Step 6: Report to User

Provide summary:
- How many lessons extracted
- How many duplicates found and consolidated
- Suggested tags for future reference
- Recommendations: "Next time you work on X, check memories tagged [Y, Z]"

## Example Session

**User**: "Review the lessons learned from the PostgreSQL migration"

**Claude**:
```
I'll review the lessons-learned file. Let me read it first...

[Reads file]

Found 8 lessons in the file:
1. Database migration timing (decision)
2. Backup strategy before migration (process)
3. Schema versioning approach (technical)
4. Rollback procedure we forgot (mistake)
... [continues]

Checking memory for similar past lessons...
- Found 2 related memories about database migrations
- No duplicates, but will link them

Storing structured memories...
✓ Stored 8 new memories
✓ Created 5 relationship links
✓ Tagged with: ["postgresql", "migration", "lessons-learned", "database"]

Summary:
- 8 lessons now searchable in memory
- Linked to 2 previous migration experiences
- Next time you work on database migrations, search for tag "migration"

Would you like me to:
1. Show memory IDs for reference?
2. Create a summary artifact of all migration lessons?
3. Identify common patterns across all 3 migrations?
```

## Processing Rules

### Categorization Rules

**Type: "decision"**
- Contains explicit choice between alternatives
- Documents why we chose X over Y
- Has rationale

**Type: "reference"**
- Best practices
- Resources that were helpful
- Documentation to remember

**Type: "conversation"**
- Discussion points
- Team agreements
- Context about why something matters

### Consolidation Rules

**When to merge with existing memory:**
- Same topic, same conclusion
- One adds detail to the other
- Confidence: update existing with new information

**When to create separate but linked:**
- Same topic, different angle
- Evolution of thinking over time
- Different projects, similar lessons

### Metadata Extraction

Look for:
- **Dates**: "On 2024-10-15...", "Last month..."
- **People**: "Patrick decided...", "Team agreed..."
- **Files**: References to code files, configs, docs
- **Technologies**: Specific tools, libraries, versions
- **Outcomes**: "This worked", "This failed", "We'll try..."

## Anti-Patterns

❌ **Don't lose context** - Store enough detail to understand later  
❌ **Don't over-consolidate** - Different lessons are valuable even if similar  
❌ **Don't skip relationship creation** - Connections reveal patterns  
❌ **Don't ignore actionable items** - Mark lessons that require follow-up

## Output Format

After processing, provide markdown summary:

```markdown
# Lessons Learned Processing Summary

**Source**: [path/to/file.md]
**Date Processed**: [date]
**Lessons Extracted**: [count]

## Stored Memories

1. **[Lesson Title]** (Memory ID: [hash])
   - Type: [decision/reference/conversation]
   - Tags: [tag1, tag2, tag3]
   - Key Decision: [what we learned]
   - Linked to: [related memory IDs]

2. [continue for each...]

## Patterns Identified

- [Pattern 1]: Appears in memories [X, Y, Z]
- [Pattern 2]: Related to [topic]

## Recommendations

Next time you work on [topic], check:
- `search-enhanced("[relevant query]")`
- `list-memories-by-tag(["tag1", "tag2"])`

## Follow-up Questions

Would you like me to:
- Create visual map of relationships?
- Find similar lessons from other projects?
- Suggest areas where more documentation needed?
```
```

---

### Skill 3: `project-context-loader` (HRDAG Multi-Project)

**Pattern from**: Basic Memory project switching + hudrazine auto-detection

**Purpose**: Automatically load project-specific context at session start

**File**: `.claude/skills/project-context-loader/SKILL.md`

```yaml
---
name: project-context-loader
description: Loads project-specific memory context automatically for HRDAG work
---

# Project Context Loader

## Purpose
Automatically load relevant memory context when starting work on a project.
Essential for HRDAG's multi-project environment.

## Auto-Activation

Triggers at:
- **Session start**: Detect current project and load context
- **Project switch**: When user says "switch to [project]"
- **First mention**: When user first mentions a project name

## Detection Methods

### Method 1: Git Remote Detection
```bash
# Check git remote to identify project
git remote get-url origin

# Map to project name:
# github.com/HRDAG/colombia-data → project: "colombia"
# github.com/HRDAG/guatemala-analysis → project: "guatemala"
```

### Method 2: Directory Name
```bash
# Current working directory
pwd

# Extract project identifier from path
# /Users/patrick/hrdag/syria-conflict → project: "syria"
```

### Method 3: Explicit User Statement
```
User: "I'm working on the El Salvador data cleaning"
→ project: "el-salvador"

User: "Switch to Guatemala project"
→ project: "guatemala"
```

## Workflow

### At Session Start

1. **Detect Project**
   ```
   Determine current project using detection methods above
   ```

2. **Query Project Context**
   ```
   get-recent-context(
     project: "<detected-project>",
     limit: 10
   )
   ```

3. **Load Key Memories**
   ```
   # Get active work
   search-enhanced(
     query: "current progress blockers todo",
     filters: {
       project: "<project>",
       type: "conversation"
     }
   )
   
   # Get architectural decisions
   list-memories-by-tag([
     "<project>",
     "architecture",
     "decisions"
   ])
   
   # Get recent problems/solutions
   search-enhanced(
     query: "bugs errors solutions",
     filters: {
       project: "<project>",
       type: "code",
       date_from: "-30days"
     }
   )
   ```

4. **Present Context Summary**
   ```markdown
   # Project Context: [Project Name]
   
   ## Last Session
   [Date of last work on this project]
   - Working on: [Last feature/task]
   - Progress: [Status]
   - Left off at: [Specific file/function]
   
   ## Active Decisions
   - [Decision 1]: [Why]
   - [Decision 2]: [Why]
   
   ## Current Blockers
   - [Blocker 1]: [Description]
   - [Blocker 2]: [Description]
   
   ## Watch Out For
   - [Known issue 1]
   - [Common mistake 2]
   
   ## Relevant Patterns
   - [Pattern 1]: Used in [file/feature]
   - [Pattern 2]: Established in [previous work]
   
   Ready to continue? What would you like to work on?
   ```

### On Project Switch

1. **Save Checkpoint for Current Project**
   ```
   store-dev-memory({
     type: "conversation",
     content: "Session checkpoint: [summary of current session]",
     project: "<current-project>",
     tags: ["checkpoint", "session-end"],
     metadata: {
       session_summary: "What was accomplished",
       open_tasks: ["Task 1", "Task 2"],
       next_steps: "What to do next session",
       files_in_progress: ["file1.py", "file2.py"]
     }
   })
   ```

2. **Load Context for New Project**
   (Follow "At Session Start" workflow above)

3. **Present Context Switch Summary**
   ```markdown
   # Switching from [Old Project] to [New Project]
   
   ## Saved checkpoint for [Old Project]
   - Progress saved
   - Can resume with: `load-project-checkpoint("[old-project]")`
   
   ## Loading context for [New Project]
   [Present context summary as above]
   ```

## Project Configuration

### HRDAG Project Registry

Maintain mapping of projects to metadata:

```json
{
  "projects": {
    "colombia": {
      "full_name": "Colombia Violence Documentation",
      "repo_patterns": ["colombia", "co-"],
      "common_tags": ["colombia", "statistical-analysis", "entity-resolution"],
      "key_contacts": ["Patrick", "Person2"],
      "data_location": "/path/to/colombia/data"
    },
    "syria": {
      "full_name": "Syria Conflict Documentation",
      "repo_patterns": ["syria", "sy-"],
      "common_tags": ["syria", "statistical-model", "record-linkage"],
      "key_contacts": ["Patrick", "Person3"],
      "data_location": "/path/to/syria/data"
    }
    // ... more projects
  }
}
```

### Project-Specific Queries

Each project can have custom context queries:

```python
project_queries = {
  "colombia": {
    "recent_work": "entity resolution Colombia patterns",
    "common_issues": "Colombia data quality edge cases",
    "architecture": "Colombia statistical model decisions"
  },
  "syria": {
    "recent_work": "Syria record linkage progress",
    "common_issues": "Syria data parsing errors",
    "architecture": "Syria database schema decisions"
  }
}
```

## Tool Commands

### load-project-context

**Manual invocation**:
```
User: "Load context for Syria project"
Claude: [Runs context loading workflow]
```

### save-project-checkpoint

**Manual invocation**:
```
User: "Save checkpoint before I switch to Guatemala"
Claude: [Saves current state, then ready to switch]
```

### list-projects

**Manual invocation**:
```
User: "What projects do we have memory for?"
Claude:
Projects with stored memories:
1. Colombia (45 memories, last active: 2 days ago)
2. Syria (78 memories, last active: 1 week ago)
3. Guatemala (23 memories, last active: 3 weeks ago)
4. El Salvador (12 memories, last active: 2 months ago)

Which project would you like to load?
```

## Advanced Features

### Cross-Project Pattern Detection

```
User: "We solved a similar data quality problem in Colombia. Can you find it?"

Claude:
Searching across all projects for data quality solutions...

Found 3 similar solutions:
1. Colombia (2024-08): [Solution description]
2. Syria (2024-06): [Solution description]
3. Guatemala (2024-03): [Solution description]

The Colombia solution seems most applicable because [reasoning].
Would you like me to:
1. Show full details of Colombia solution?
2. Adapt it to current project context?
3. Create memory linking this to past solutions?
```

### Project Health Dashboard

```
User: "Show project health for all HRDAG projects"

Claude:
# HRDAG Projects Health Dashboard

## Colombia
- Status: ✅ Active (worked on 2 days ago)
- Memories: 45
- Open Blockers: 1
- Recent Activity: Entity resolution optimization

## Syria
- Status: ⚠️ Paused (1 week since last work)
- Memories: 78
- Open Blockers: 3
- Recent Activity: Database migration

## Guatemala
- Status: ⚠️ Attention Needed (3 weeks inactive)
- Memories: 23
- Open Blockers: 2
- Recent Activity: Data cleaning scripts

## El Salvador
- Status: ⏸️ Archived (2 months inactive)
- Memories: 12
- Open Blockers: 0
- Recent Activity: Final report generation

Would you like details on any project?
```

## Anti-Patterns

❌ **Don't mix project contexts** - Keep memories isolated  
❌ **Don't forget to checkpoint** - Always save before switching  
❌ **Don't assume project from incomplete info** - Ask user to confirm  
❌ **Don't load irrelevant context** - Filter by recency and relevance

## Success Metrics

- Project detected correctly 95%+ of time
- Context loads in <2 seconds
- User immediately has relevant information
- No need to re-explain project background
```

---

## Implementation Roadmap

### Phase 1: Enhance claude-mem MCP Server (2-3 weeks)

**Week 1: Natural Trigger Detection + Consolidation**
- [ ] Implement keyword detection (50ms) for "remember", "note:", "important:"
- [ ] Add semantic analysis layer (150ms) using existing embeddings
- [ ] Build consolidation algorithm (find similar memories, merge logic)
- [ ] Add importance scoring
- [ ] Write tests for trigger accuracy

**Week 2: Git Integration + Session Management**
- [ ] Add git hooks for auto-save on commit
- [ ] Implement branch-aware memory channels
- [ ] Add SHA-256 file tracking
- [ ] Build session checkpoint system
- [ ] Create checkpoint restoration logic

**Week 3: Project Switching + Export**
- [ ] Add project configuration system
- [ ] Implement project context switching
- [ ] Build markdown export functionality
- [ ] Add project isolation enforcement
- [ ] Create project health metrics

**Deliverables:**
- Updated claude-mem MCP server with new tools
- Documentation for new features
- Test suite covering new functionality

---

### Phase 2: Build Core Skills (2-3 weeks)

**Week 1: memory-augmented-dev Skill**
- [ ] Write SKILL.md with full instructions
- [ ] Document all MCP tool calls with examples
- [ ] Create workflow diagrams
- [ ] Write anti-pattern documentation
- [ ] Test skill activation and effectiveness

**Week 2: lessons-learned-reviewer Skill**
- [ ] Write SKILL.md for lesson extraction
- [ ] Define categorization rules
- [ ] Create consolidation logic documentation
- [ ] Build extraction patterns for common formats
- [ ] Test with existing lessons-learned files

**Week 3: project-context-loader Skill**
- [ ] Write SKILL.md for auto-loading
- [ ] Define project detection methods
- [ ] Create context summary templates
- [ ] Build project registry
- [ ] Test project switching workflows

**Deliverables:**
- Three working skills in `.claude/skills/` directory
- Comprehensive documentation with examples
- Test scenarios for each skill

---

### Phase 3: HRDAG Workflow Integration (1-2 weeks)

**Week 1: CLAUDE.md Templates**
- [ ] Create base CLAUDE.md that imports skills
- [ ] Write project-specific CLAUDE.md variants
- [ ] Document memory workflow for common tasks
- [ ] Create quick-start guide for team
- [ ] Test full workflow end-to-end

**Week 2: Training + Documentation**
- [ ] Create user guide for HRDAG team
- [ ] Record demo videos of workflows
- [ ] Document common patterns and tips
- [ ] Create troubleshooting guide
- [ ] Run training session with team

**Deliverables:**
- CLAUDE.md templates for HRDAG projects
- User documentation and training materials
- Video demonstrations

---

### Phase 4: Team Features (2-3 weeks)

**Week 1-2: OAuth + HTTP Transport**
- [ ] Implement OAuth 2.1 authentication
- [ ] Add HTTP transport alongside stdio
- [ ] Create permission management system
- [ ] Build team member administration
- [ ] Test multi-user access patterns

**Week 3: Web Dashboard**
- [ ] Create basic web interface (port 8888)
- [ ] Add memory browsing capability
- [ ] Implement search interface
- [ ] Add edit/delete functionality
- [ ] Create visualizations for memory relationships

**Deliverables:**
- Multi-user capable claude-mem server
- Web dashboard for team access
- Administration documentation

---

## Critical Success Factors

Based on analysis of all 18+ systems reviewed:

### 1. Natural Language Operations
**What it means**: Users say "remember this", not explicit save commands  
**Why it matters**: Reduces cognitive overhead, feels natural  
**How to achieve**: Implement trigger detection from doobidoo

### 2. Automatic Skill Activation
**What it means**: Skills trigger on context, not /commands  
**Why it matters**: Users don't need to remember commands  
**How to achieve**: Well-crafted frontmatter descriptions in SKILL.md

### 3. Progressive Disclosure
**What it means**: Simple tasks stay simple, complex tasks get full power  
**Why it matters**: Prevents overwhelming users and wasting tokens  
**How to achieve**: Skills query memory proportional to task complexity

### 4. Git Integration
**What it means**: Memory tied to code changes (timestamps, branches, commits)  
**Why it matters**: Provides temporal context and traceability  
**How to achieve**: Git hooks + SHA tracking from mcp-memory-keeper

### 5. Human-Readable Export
**What it means**: Always be able to review/edit memory as markdown  
**Why it matters**: Trust, transparency, manual correction capability  
**How to achieve**: Markdown export from basic-memory pattern

### 6. Project Isolation
**What it means**: Different projects = different memory contexts  
**Why it matters**: Prevents context pollution across HRDAG projects  
**How to achieve**: Project namespacing + context switching

### 7. Fast Retrieval
**What it means**: <500ms for semantic search  
**Why it matters**: Users won't wait; breaks flow if slow  
**How to achieve**: Your PostgreSQL + pgvector already does this

### 8. Token Efficiency
**What it means**: Only load relevant memory, not everything  
**Why it matters**: Stay within context limits, reduce costs  
**How to achieve**: Progressive disclosure + targeted queries

**Current State**: Your claude-mem already excels at #7 and #8. Build #1-#6 next.

---

## Comparison: Your claude-mem vs Others

### Strengths (Keep These)

| Feature | Your Implementation | Others | Winner |
|---------|---------------------|--------|--------|
| Embedding Dimensions | 768d (nomic-embed-text) | 384d-768d | **Yours** (tied for best) |
| Memory Types | Code, Decisions, Conversations, References | Generic or none | **Yours** (specialized) |
| Metadata Richness | Implementation status, key decisions, files, changes, dependencies | Basic tags and content | **Yours** (comprehensive) |
| Database | PostgreSQL + pgvector | SQLite, JSONL, or PostgreSQL | **Yours** (production-grade) |
| Relationship Tracking | Yes, with relationship types | Some have it, some don't | **Yours** (good) |
| Project Organization | Yes | Some have it | **Yours** (good) |

### Gaps (Add These)

| Feature | Your Implementation | Leaders | Priority |
|---------|---------------------|---------|----------|
| Natural Triggers | No | doobidoo (85% accuracy) | **High** |
| Git Integration | No | mcp-memory-keeper (auto-commit) | **High** |
| Auto-Consolidation | No | doobidoo (merge similar) | **High** |
| Session Checkpoints | No | mcp-memory-keeper | **High** |
| Document Ingestion | No | doobidoo (PDF, MD, CSV) | **Medium** |
| HTTP + OAuth | No | doobidoo (team collab) | **Medium** |
| Markdown Export | No | basic-memory (human review) | **Medium** |
| Web Dashboard | No | doobidoo (port 8888) | **Low** |

---

## Risk Analysis & Mitigation

### Risk 1: Skill Complexity
**Risk**: Skills too complex, Claude doesn't follow them  
**Mitigation**: Start simple, add complexity incrementally. Test with real tasks.

### Risk 2: Memory Pollution
**Risk**: Too much stored, retrieval becomes noisy  
**Mitigation**: Implement consolidation, aging/deprecation, and confidence scoring

### Risk 3: Performance Degradation
**Risk**: As memory grows, queries slow down  
**Mitigation**: Your pgvector + proper indexing handles this. Monitor query times.

### Risk 4: Team Adoption
**Risk**: HRDAG team doesn't use it  
**Mitigation**: Make it invisible (auto-activation), show immediate value (context loading)

### Risk 5: Migration Effort
**Risk**: Porting existing lessons-learned files is tedious  
**Mitigation**: Build `lessons-learned-reviewer` skill that automates bulk import

---

## Next Steps (Recommended Order)

### Immediate (This Week)
1. Write `memory-augmented-dev` SKILL.md using existing claude-mem tools
2. Test skill with a real HRDAG task
3. Refine based on what works/doesn't work

### Short-term (Next 2 Weeks)
4. Add natural trigger detection to claude-mem
5. Add git integration to claude-mem
6. Write `lessons-learned-reviewer` skill
7. Bulk import existing lessons-learned markdown files

### Medium-term (Next Month)
8. Implement session checkpoints
9. Build project context switching
10. Write `project-context-loader` skill
11. Create CLAUDE.md templates for HRDAG projects

### Long-term (Next 2-3 Months)
12. Add OAuth for team collaboration
13. Build web dashboard for memory review
14. Document everything for HRDAG team
15. Train team on memory-augmented workflows

---

## Appendix: Full Repository Reference

### MCP Memory Servers
1. doobidoo/mcp-memory-service: https://github.com/doobidoo/mcp-memory-service
2. mcp-memory-keeper: https://github.com/mkreyman/mcp-memory-keeper
3. @modelcontextprotocol/server-memory: https://github.com/modelcontextprotocol/servers/tree/main/src/memory
4. sdimitrov/mcp-memory: https://github.com/sdimitrov/mcp-memory
5. basicmachines-co/basic-memory: https://github.com/basicmachines-co/basic-memory
6. Puliczek/mcp-memory: https://github.com/Puliczek/mcp-memory
7. coleam00/mcp-mem0: https://github.com/coleam00/mcp-mem0
8. alioshr/memory-bank-mcp: https://github.com/alioshr/memory-bank-mcp

### Workflow/Memory Bank Frameworks
9. tony/claude-code-riper-5: https://github.com/tony/claude-code-riper-5
10. hudrazine/claude-code-memory-bank: https://github.com/hudrazine/claude-code-memory-bank
11. vanzan01/cursor-memory-bank: https://github.com/vanzan01/cursor-memory-bank
12. centminmod/my-claude-code-setup: https://github.com/centminmod/my-claude-code-setup
13. johnpeterman72/cursor_memory_riper_framework: https://github.com/johnpeterman72/cursor_memory_riper_framework
14. johnpeterman72/CursorRIPER: https://github.com/johnpeterman72/CursorRIPER

### Skills/Plugins
15. EveryInc/every-marketplace: https://github.com/EveryInc/every-marketplace
16. obra/superpowers: https://github.com/obra/superpowers
17. ruvnet/claude-flow: https://github.com/ruvnet/claude-flow
18. ComposioHQ/awesome-claude-skills: https://github.com/ComposioHQ/awesome-claude-skills
19. travisvn/awesome-claude-skills: https://github.com/travisvn/awesome-claude-skills
20. mrgoonie/claudekit-skills: https://github.com/mrgoonie/claudekit-skills
21. abubakarsiddik31/claude-skills-collection: https://github.com/abubakarsiddik31/claude-skills-collection

### Integration Examples
22. lukerf89/claude-basic-memory-workflow: https://github.com/lukerf89/claude-basic-memory-workflow
23. hesreallyhim/awesome-claude-code: https://github.com/hesreallyhim/awesome-claude-code

### Documentation References
- Basic Memory Claude Code docs: https://docs.basicmemory.com/integrations/claude-code/
- Claude Code official docs: https://docs.claude.com/en/docs/claude-code/
- MCP documentation: https://modelcontextprotocol.io/

---

## Conclusion

Your claude-mem project has a strong foundation with PostgreSQL + pgvector, 768-dimensional embeddings, and dev-specific memory types. The path forward is clear:

1. **Enhance** claude-mem with natural triggers, git integration, and session management
2. **Build** three core skills that orchestrate memory workflows
3. **Integrate** with HRDAG workflows through CLAUDE.md templates
4. **Scale** to team collaboration with OAuth and web dashboard

The Every marketplace's compounding-engineering plugin provides the clearest template for your skills layer. Their "research before implement, document after" pattern maps perfectly to your needs.

No one else is doing exactly what you're planning - combining MCP semantic search with HRDAG-specific workflows and lessons-learned integration. You're pioneering this space.

**Recommendation**: Start small (one skill this week), validate the approach with real work, then scale. Your technical foundation is solid; focus on making the user experience invisible and valuable.
