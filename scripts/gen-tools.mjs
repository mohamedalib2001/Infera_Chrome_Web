// Regenerates native-host/tools.json (the MCP tool surface shown before a
// browser connects) from the extension's tool definitions.
import { writeFileSync } from 'node:fs';
import { MCP_TOOLS } from '../extension/background/tools/definitions.js';

const tools = MCP_TOOLS.map(({ name, description, input_schema }) => ({ name, description, inputSchema: input_schema }));
writeFileSync(new URL('../native-host/tools.json', import.meta.url), JSON.stringify(tools, null, 2) + '\n');
console.log(`wrote ${tools.length} tools`);
