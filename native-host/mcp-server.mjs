// browser-click's page tools as a stdio MCP server. claude starts it through
// the --mcp-config the host gives it, with the path of the host's private
// socket as its only argument. It speaks MCP (newline-delimited JSON-RPC) to
// claude and forwards each tool call to the host, which passes it on to the
// page through the extension. It knows nothing about the tools themselves:
// their definitions come from the host, and the page runs them. Plain Node,
// no dependencies.
import { connect } from 'node:net';
import { readLines } from './read-lines.mjs';

const SERVER_INFO = { name: 'browser-click', version: '0.1.0' };
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const socketPath = process.argv[2];
if (!socketPath) {
  process.stderr.write('usage: mcp-server.mjs <host socket>\n');
  process.exit(2);
}

/** @type {{ name: string, description: string, inputSchema: object }[] | null} */
let tools = null;
const toolsReady = [];
/** Tool calls forwarded to the host, by our own ID, waiting for the page's result. */
const pending = new Map();
let nextCallId = 1;

const host = connect(socketPath);
readLines(host, (line) => {
  const message = JSON.parse(line);
  if (message.type === 'tools') {
    tools = Array.isArray(message.tools) ? message.tools : [];
    toolsReady.splice(0).forEach((resolve) => resolve());
  } else if (message.type === 'result') {
    pending.get(message.id)?.(message.result);
    pending.delete(message.id);
  }
});
// Without the host, no call can be answered: end, so claude sees the server go.
host.on('error', () => process.exit(1));
host.on('close', () => process.exit(0));

readLines(process.stdin, (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  handle(request).catch((error) => {
    if (request.id !== undefined) reply(request.id, undefined, { code: -32603, message: String(error?.message ?? error) });
  });
});
process.stdin.on('end', () => process.exit(0));

async function handle({ id, method, params }) {
  // Notifications (no id), such as notifications/initialized, need no answer.
  if (id === undefined) return;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: await offeredTools() });
    case 'tools/call':
      return reply(id, await call(params?.name, params?.arguments ?? {}));
    default:
      return reply(id, undefined, { code: -32601, message: `Method not found: ${method}` });
  }
}

async function offeredTools() {
  if (!tools) await new Promise((resolve) => toolsReady.push(resolve));
  return tools;
}

async function call(name, input) {
  if (!(await offeredTools()).some((tool) => tool.name === name)) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  const id = nextCallId++;
  const result = new Promise((resolve) => pending.set(id, resolve));
  host.write(JSON.stringify({ type: 'call', id, name, input }) + '\n');
  return result;
}

function reply(id, result, error) {
  process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n');
}
