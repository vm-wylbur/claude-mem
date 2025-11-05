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
# Copy skills to your Claude Code skills directory
cp -r skills/memory-augmented-dev ~/.claude/skills/

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

## Skill Lifecycle

Skills in this directory are **cached versions** for version control. They should be:
- **Installed** to `~/.claude/skills/` to be active
- **Updated** here when modified, then re-copied to `~/.claude/skills/`
- **Tracked** in git for team sharing and version history

## More Information

- Claude Code Skills Documentation: https://docs.claude.com/docs/claude-code
- Memory System Overview: See main README.md
- MCP Server Setup: See README.md "Configuring as a User-Wide MCP Server"
