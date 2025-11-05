<!--
Author: PB and Claude
Date: 2025-11-04
License: (c) HRDAG, 2025, GPL-2 or newer

------
docs/mcp-server-installation-notes.md
-->

# MCP Server Installation Process

**Purpose**: Document the process of installing MCP servers for creating an automated skill

**Date**: 2025-11-04

**Example**: Installing postgres-mcp MCP server

---

## Prerequisites

### 1. Install the MCP Server Binary

MCP servers can be installed via various package managers:

**Python-based servers (using uv - preferred):**
```bash
# Install user-wide (essential for Claude Code to access)
uv tool install <package-name>

# Example: postgres-mcp
uv tool install postgres-mcp
# Installs to: ~/.local/bin/postgres-mcp
```

**Node.js-based servers (using npm):**
```bash
npm install -g <package-name>
# Or build from source
cd /path/to/mcp-server
npm run build
# Binary location: /path/to/mcp-server/dist/index.js
```

**Key insight**: Always verify the installation location. This path will be used in the `claude mcp add` command.

---

## Using `claude mcp add` Command

### Command Structure

```bash
claude mcp add [options] <name> <commandOrUrl> [args...]
```

**Parameters:**
- `[options]`: Command-line flags (--scope, --transport, --env, --header)
- `<name>`: Human-readable server name (used in `claude mcp list`)
- `<commandOrUrl>`:
  - For stdio: absolute path to binary
  - For http/sse: URL endpoint
- `[args...]`: Additional arguments passed to the server command

**Important options:**
- `--scope <scope>`: Where to save config (local, user, project)
  - **Always use `--scope user`** for user-wide availability
- `--transport <transport>`: Connection type (stdio, sse, http)
  - Local binaries: use `stdio`
- `--env <env...>`: Environment variables (format: `-e KEY=value`)
  - Can specify multiple: `-e KEY1=value1 -e KEY2=value2`

### Argument Ordering (CRITICAL!)

The `--env` flag must come **after** the server name, **before** the `--` separator:

```bash
# CORRECT:
claude mcp add --scope user --transport stdio <name> --env KEY=value -- <command>

# WRONG:
claude mcp add --scope user --transport stdio --env KEY=value <name> -- <command>
# Error: missing required argument 'name'
```

### Using the `--` Separator

The `--` separates `claude mcp add` arguments from the server command and its arguments:

```bash
claude mcp add [claude-options] <name> [claude-options] -- <server-command> [server-args]
```

**Example 1: Simple stdio server (no server args)**
```bash
claude mcp add --scope user --transport stdio postgres-mcp -- /home/pball/.local/bin/postgres-mcp
```

**Example 2: With environment variables**
```bash
claude mcp add --scope user --transport stdio postgres-mcp \
  --env DATABASE_URI="postgres://user:pass@host:port/db?sslmode=require" \
  -- /home/pball/.local/bin/postgres-mcp
```

**Example 3: With server-specific arguments**
```bash
claude mcp add --scope user --transport stdio myserver \
  --env API_KEY="secret123" \
  -- npx -y some-mcp-server --verbose --port 8080
```

---

## Verification

### 1. Check MCP Server List
```bash
claude mcp list
```

Expected output:
```
postgres-mcp: /home/pball/.local/bin/postgres-mcp - ✓ Connected
```

### 2. Inspect Configuration
```bash
# View the added configuration
jq '.mcpServers."postgres-mcp"' ~/.claude.json
```

Expected structure:
```json
{
  "type": "stdio",
  "command": "/home/pball/.local/bin/postgres-mcp",
  "args": [],
  "env": {
    "DATABASE_URI": "postgres://avnadmin:PASSWORD@host:port/db?sslmode=require"
  }
}
```

---

## Full Installation Example: postgres-mcp

### Step 1: Install the binary
```bash
# Install postgres-mcp using uv (user-wide)
uv tool install postgres-mcp

# Verify installation
which postgres-mcp
# Output: /home/pball/.local/bin/postgres-mcp
```

### Step 2: Add to Claude Code
```bash
# Add with database connection string
claude mcp add --scope user --transport stdio postgres-mcp \
  --env DATABASE_URI="postgres://avnadmin:YOUR_PASSWORD@pg-2c908149-claude-mem.e.aivencloud.com:24030/defaultdb?sslmode=require" \
  -- /home/pball/.local/bin/postgres-mcp
```

**Output:**
```
Added stdio MCP server postgres-mcp with command: /home/pball/.local/bin/postgres-mcp to user config
File modified: /home/pball/.claude.json
```

### Step 3: Verify installation
```bash
claude mcp list
```

**Output:**
```
postgres-mcp: /home/pball/.local/bin/postgres-mcp  - ✓ Connected
```

---

## Common Installation Patterns

### Pattern 1: Python MCP server with uv
```bash
# Install
uv tool install <package-name>

# Add to Claude Code
claude mcp add --scope user --transport stdio <server-name> \
  --env CONFIG_VAR="value" \
  -- ~/.local/bin/<binary-name>
```

### Pattern 2: Node.js MCP server from project
```bash
# Build the project
cd /path/to/mcp-server
npm run build

# Add to Claude Code
claude mcp add --scope user --transport stdio <server-name> \
  --env API_KEY="key" \
  -- node /path/to/mcp-server/dist/index.js
```

### Pattern 3: HTTP/SSE MCP server
```bash
# No local installation needed
claude mcp add --transport http <server-name> https://mcp.example.com/endpoint
```

---

## Configuration File Location

**User-wide config**: `~/.claude.json`
- Contains `mcpServers` object with all installed servers
- Each server has: `type`, `command`, `args`, `env`

**Project-local config**: `.claude/.claude.json` (in project directory)
- Use `--scope local` to add here instead
- Only available when working in that project

---

## Troubleshooting

### Error: "missing required argument 'name'"
- **Cause**: Wrong argument order, likely `--env` before server name
- **Fix**: Move `--env` after the server name: `<name> --env KEY=value`

### Error: "missing required argument 'commandOrUrl'"
- **Cause**: Missing the `--` separator or command path
- **Fix**: Ensure format is: `<name> [options] -- <command>`

### Server shows "✗ Failed" in `claude mcp list`
- **Cause**: Binary not found, wrong path, or missing dependencies
- **Fix**: Verify binary path with `which <binary-name>`
- **Fix**: Check environment variables are correct
- **Fix**: Test binary manually: `<command-path> --help`

### Environment variable not being passed
- **Cause**: Wrong syntax or placement
- **Fix**: Use format `--env KEY="value"` with quotes for complex values
- **Fix**: Place `--env` after server name, before `--`

---

## Key Learnings for Skill Creation

1. **Always use `--scope user`** for user-wide availability across all projects
2. **Argument order matters**: `--env` must come after server name
3. **Use absolute paths** for binary locations (no `~`, expand to `/home/user/`)
4. **Quote environment variables** that contain special characters (URLs, passwords)
5. **Verify with `claude mcp list`** to ensure successful installation
6. **Test the binary directly** before adding to Claude Code
7. **Document required environment variables** for each MCP server type

---

## Next Steps: Creating an MCP Installation Skill

The skill should:
1. Detect MCP server type (Python/Node.js/HTTP)
2. Guide installation of binary (uv/npm/none)
3. Prompt for required environment variables
4. Construct and execute `claude mcp add` command
5. Verify installation with `claude mcp list`
6. Store common MCP server configurations in memory

**Skill name**: `mcp-server-install`

**Activation keywords**: "install MCP server", "add MCP", "configure MCP"
