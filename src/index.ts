/*
Author: PB and Claude
Date: 2026-02-28
License: (c) HRDAG, 2025, GPL-2 or newer

---
claude-mem/src/index.ts
*/

// Stdio entry point. Connects the MCP server to Claude Code via stdin/stdout.

import { config } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DatabaseService } from './db/service.js';
import { createDatabaseAdapterToml } from './config.js';
import { getConfigSummaryToml } from './config-toml.js';
import { storeInitialProgress } from './dev-memory.js';
import { createServer } from './server.js';

config();

console.error('Starting Memory MCP Server (stdio)');
console.error(getConfigSummaryToml());

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

const server = createServer(dbService);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Memory MCP Server ready');
