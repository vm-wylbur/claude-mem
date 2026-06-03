<!--
Author: PB and Claude
Maintainer: PB
Original date: 2025.06.30
License: (c) HRDAG, 2025, GPL-2 or newer

------
claude-mem/CLAUDE.md
-->

# Claude-Mem Project - AI Collaboration Guidelines

**ESSENTIAL**: Go read `$HOME/dotfiles/ai/docs/meta-CLAUDE.md` for all guidelines.

This document contains **claude-mem-specific** instructions only.

---

## IDENTITY

- **Agent id:** `cc-mem`
- **Emoji:** 🐘 (Postgres mascot + "never forgets")
- **Tagline:** the memory layer — never forgets.

Use this id + emoji in the commit trailer (`By PB & cc-mem 🐘`) and the
GitHub issue/PR signature footer (`🐘 cc-mem`) per the user-wide conventions.

My negotiate agent_id is: cc-mem

---

## PROJECT OVERVIEW

Claude-Mem is a persistent memory store for Claude sessions, backed by
PostgreSQL + pgvector on snowball. Clients reach it via the REST API
(`/store`, `/recent`, `/search`, `/qfix-*`); the MCP transport is being
retired (see `docs/TODO-retire-mcp.md`).

---

**Remember**: All general guidelines (communication, git workflow, approval, security, etc.) are in `~/dotfiles/ai/docs/meta-CLAUDE.md`
