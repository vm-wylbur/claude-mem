<!--
Author: PB and Claude
Date: Sun 04 Nov 2025
License: (c) HRDAG, 2025, GPL-2 or newer

------
skills/README.md
-->

# Claude Code Skills for claude-mem

This directory contains Claude Code skills that enhance development workflows with the claude-mem MCP server.

## Installation

Skills are installed at the **user level**, not per-project. To install:

```bash
# Copy all skills to your Claude Code skills directory
cp -r skills/* ~/.claude/skills/

# Or copy individual skills
cp -r skills/memory-augmented-dev ~/.claude/skills/
cp -r skills/postgres-optimization ~/.claude/skills/

# Verify installation
ls -la ~/.claude/skills/
```

## Available Skills

### memory-augmented-dev

**Description:** Development with persistent memory checks and automatic logging

**When it activates:**
- User requests to implement features, fix bugs, or refactor code
- Keywords: "implement", "build", "fix", "refactor", "add feature"

**What it does:**
- Searches memory for relevant patterns before implementing
- Reviews past decisions and mistakes
- Applies established patterns
- Stores learnings after task completion with rich metadata

**Usage:**
The skill activates automatically when you start coding tasks. It ensures you:
1. Check memory for existing solutions before implementing
2. Apply lessons from past work
3. Document new learnings for future reference

### postgres-optimization

**Description:** PostgreSQL database optimization combining institutional knowledge with live analysis

**Requires:** postgres-mcp MCP server (install: `uv tool install postgres-mcp`)

**When it activates:**
- Database performance issues or optimization requests
- Keywords: "optimize database", "slow query", "performance tuning", "analyze query", "database health"

**What it does:**
1. **Research Phase**: Searches memory for similar past optimizations and proven patterns
2. **Analysis Phase**: Uses postgres-mcp tools to analyze current database state
   - Database health checks (buffer cache, bloat, vacuum status)
   - Slow query identification (pg_stat_statements)
   - Query execution plan analysis
   - Automated index recommendations
3. **Synthesis Phase**: Combines past learnings with current analysis for intelligent recommendations
4. **Implementation Phase**: Executes optimizations (with confirmation) and verifies results
5. **Documentation Phase**: Stores optimization learnings back to memory

**Usage:**
The skill provides a complete optimization workflow:
- Learns from every past optimization
- Applies proven patterns to new problems
- Tests recommendations before implementing
- Builds institutional knowledge over time
- Never repeats past mistakes

**Safety**: Read-only by default, requires explicit confirmation for DDL operations

## Skill Lifecycle

Skills in this directory are **cached versions** for version control. They should be:
- **Installed** to `~/.claude/skills/` to be active
- **Updated** here when modified, then re-copied to `~/.claude/skills/`
- **Tracked** in git for team sharing and version history

## More Information

- Claude Code Skills Documentation: https://docs.claude.com/docs/claude-code
- Memory System Overview: See main README.md
- MCP Server Setup: See README.md "Configuring as a User-Wide MCP Server"
