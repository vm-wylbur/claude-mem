/*
Author: PB and Claude
Date: 2026-02-28
License: (c) HRDAG, 2025, GPL-2 or newer

---
claude-mem/src/index-http.ts
*/

// HTTP entry point. Exposes the MCP server over Streamable HTTP for multi-machine access.
// Run on the machine that hosts PostgreSQL; clients connect via Tailscale.
//
// Client config (~/.claude.json):
//   {
//     "mcpServers": {
//       "claude-mem": {
//         "type": "http",
//         "url": "http://snowball.tailnet:3456/mcp",
//         "headers": { "X-Claude-Mem-Secret": "${CLAUDE_MEM_SECRET}" }
//       }
//     }
//   }
//
// Or via CLI:
//   claude mcp add --transport http --scope user claude-mem \
//     http://snowball.tailnet:3456/mcp \
//     --header "X-Claude-Mem-Secret: ${CLAUDE_MEM_SECRET}"

import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseService } from './db/service.js';
import { createDatabaseAdapterToml } from './config.js';
import { getConfigSummaryToml } from './config-toml.js';
import { storeInitialProgress } from './dev-memory.js';
import { createServer } from './server.js';

config();

const PORT = parseInt(process.env.CLAUDE_MEM_PORT ?? '3456', 10);
const SECRET = process.env.CLAUDE_MEM_SECRET;

console.error('Starting Memory MCP Server (HTTP)');
console.error(getConfigSummaryToml());
if (!SECRET) {
    console.error('WARNING: CLAUDE_MEM_SECRET not set — endpoint is unauthenticated');
}

const adapter = await createDatabaseAdapterToml();
const dbService = new DatabaseService(adapter);
await dbService.initialize();

const existingMemories = await dbService.getDevMemories();
if (existingMemories.length === 0) {
    console.error('Storing initial development progress...');
    await storeInitialProgress(dbService);
} else {
    console.error(`Found ${existingMemories.length} existing memories`);
}

const app = express();
app.use(express.json());

// Belt-and-suspenders auth on top of Tailscale network-layer protection.
// If CLAUDE_MEM_SECRET is set, all requests must include the matching header.
app.use((req, res, next) => {
    if (SECRET && req.headers['x-claude-mem-secret'] !== SECRET) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    next();
});

// Active transports keyed by sessionId
const transports = new Map<string, StreamableHTTPServerTransport>();

async function mcpHandler(req: express.Request, res: express.Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST' && !sessionId) {
        // New session — must be an initialize request
        if (!isInitializeRequest(req.body)) {
            res.status(400).json({ error: 'expected initialize request' });
            return;
        }
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
                transports.set(id, transport);
                console.error(`Session initialized: ${id}`);
            },
        });
        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
                console.error(`Session closed: ${transport.sessionId}`);
            }
        };
        const server = createServer(dbService);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
    }

    // Existing session
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
        res.status(404).json({ error: `session not found: ${sessionId}` });
        return;
    }
    await transport.handleRequest(req, res, req.body);
}

app.all('/mcp', mcpHandler);

app.listen(PORT, '0.0.0.0', () => {
    console.error(`Memory MCP Server (HTTP) listening on port ${PORT}`);
});
