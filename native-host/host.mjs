// browser-click's native messaging host: Chrome starts one copy per open
// Conversation, and it runs one long-lived `claude -p` process for it.
// Messages from Chrome go to claude's stdin as stream-json; claude's stream-json
// output comes back as native messages. The host exits when claude does or
// when Chrome disconnects. Plain Node, no dependencies: it runs from this folder.
//
// When the extension offers page tools, the host also serves them to claude
// through mcp-server.mjs (given to claude with --mcp-config). That server
// reaches back to this host over a private socket; each tool call goes on to
// the extension as a page-tool-call, and its page-tool-result comes back.
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLines } from './read-lines.mjs';

const CONFIG_PATH = join(homedir(), '.browser-click', 'host-config.json');

/** Chrome rejects native messages over 1 MB from the host. */
const MAX_MESSAGE_BYTES = 1024 * 1024;

/** claude output types the extension uses. Tool results ("user") can be large and are not needed. */
const FORWARDED_TYPES = new Set(['system', 'stream_event', 'assistant', 'result']);

const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-]*$/i;

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** The MCP server's name, so claude calls its tools mcp__browser-click__<name>. */
const MCP_SERVER_NAME = 'browser-click';

const MCP_SERVER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs');

const config = loadConfig();
// Chrome starts the host with a minimal PATH. A claude installed through npm is
// a Node script, so the Node running this host must be findable.
const env = { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(':') };

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let child = null;
let stderrTail = '';
/** @type {ReturnType<typeof servePageTools> | null} */
let pageTools = null;

readNativeMessages(process.stdin, (message) => {
  try {
    handle(message);
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
process.stdin.on('end', () => {
  child?.kill();
  pageTools?.close();
  process.exit(0);
});

function handle(message) {
  switch (message.type) {
    case 'ping':
      return void ping();
    case 'open':
      return open(message);
    case 'ask':
      return write({ type: 'user', message: { role: 'user', content: message.content } });
    case 'stop':
      return write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
    case 'page-tool-result':
      return pageTools?.result(message.callId, message.result);
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/** Reports whether claude can be found and is signed in, for the options page. */
async function ping() {
  const run = (args) =>
    new Promise((resolve) =>
      execFile(config.claudePath, args, { env, timeout: 15_000 }, (error, stdout) =>
        resolve(error ? { error: error.message } : { stdout: stdout.trim() }),
      ),
    );
  const version = await run(['--version']);
  if (version.error) return send({ type: 'pong', ok: false, message: `Couldn't run ${config.claudePath}: ${version.error}` });
  const status = await run(['auth', 'status']);
  let loggedIn = false;
  try {
    loggedIn = JSON.parse(status.stdout ?? '{}').loggedIn === true;
  } catch {
    // An older claude without JSON output: let the first question find out.
    loggedIn = true;
  }
  send({ type: 'pong', ok: true, version: version.stdout, loggedIn });
}

/**
 * Starts claude for one Conversation. With `resume`, continues the saved
 * session `sessionId` (after an earlier host for it has exited).
 */
function open({ model, webSearch, pageTools: tools = [], systemPrompt, title, sessionId, resume }) {
  if (child) throw new Error('Already open.');
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) throw new Error('Invalid model.');
  if (typeof systemPrompt !== 'string') throw new Error('Missing system prompt.');
  if (!Array.isArray(tools) || !tools.every(isToolDefinition)) throw new Error('Invalid page tools.');
  const id = typeof sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : randomUUID();
  mkdirSync(config.threadsDir, { recursive: true });

  if (tools.length) pageTools = servePageTools(tools);
  const allowedTools = [
    ...(webSearch ? ['WebSearch'] : []),
    ...tools.map((tool) => `mcp__${MCP_SERVER_NAME}__${tool.name}`),
  ];
  const mcpConfig = pageTools && {
    mcpServers: {
      [MCP_SERVER_NAME]: { type: 'stdio', command: process.execPath, args: [MCP_SERVER_SCRIPT, pageTools.socketPath] },
    },
  };

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', model,
    '--effort', 'low',
    '--system-prompt', systemPrompt,
    // Claude Code is a coding agent: give it nothing but web search and
    // browser-click's own page tools, and none of the user's settings, hooks,
    // CLAUDE.md files or MCP servers.
    '--tools', webSearch ? 'WebSearch' : '',
    ...(allowedTools.length ? ['--allowedTools', allowedTools.join(',')] : []),
    ...(mcpConfig ? ['--mcp-config', JSON.stringify(mcpConfig)] : []),
    '--permission-mode', 'dontAsk',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-chrome',
    '--disable-slash-commands',
    ...(resume ? ['--resume', id] : ['--session-id', id, '--name', sessionName(title)]),
  ];
  child = spawn(config.claudePath, args, { cwd: config.threadsDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.on('error', (error) => {
    send({ type: 'error', message: `Couldn't start ${config.claudePath}: ${error.message}` });
    process.exit(1);
  });
  child.stderr.on('data', (chunk) => (stderrTail = (stderrTail + chunk).slice(-2000)));
  readLines(child.stdout, (line) => {
    let output;
    try {
      output = JSON.parse(line);
    } catch {
      return;
    }
    if (FORWARDED_TYPES.has(output.type)) send({ type: 'output', output });
  });
  child.on('exit', (code, signal) => {
    pageTools?.close();
    send({ type: 'exit', code, signal, stderr: stderrTail.trim() });
    // Let the exit message reach Chrome before going away.
    process.stdout.write('', () => process.exit(0));
  });
  send({ type: 'opened', sessionId: id });
}

function isToolDefinition(tool) {
  return (
    tool !== null &&
    typeof tool === 'object' &&
    typeof tool.name === 'string' &&
    TOOL_NAME_PATTERN.test(tool.name) &&
    typeof tool.description === 'string' &&
    tool.inputSchema !== null &&
    typeof tool.inputSchema === 'object'
  );
}

/**
 * Listens on a private socket for mcp-server.mjs. Sends it the tool
 * definitions, forwards its calls to the extension under a fresh call ID, and
 * routes each page-tool-result back to the call it answers.
 */
function servePageTools(tools) {
  // Short: socket paths are limited to about 100 bytes.
  const socketPath = join(tmpdir(), `bc-${randomBytes(6).toString('hex')}.sock`);
  /** @type {Map<string, { socket: import('node:net').Socket, id: unknown }>} */
  const calls = new Map();
  const server = createServer((socket) => {
    socket.write(JSON.stringify({ type: 'tools', tools }) + '\n');
    readLines(socket, (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.type !== 'call' || !tools.some((tool) => tool.name === message.name)) return;
      const callId = randomUUID();
      calls.set(callId, { socket, id: message.id });
      send({ type: 'page-tool-call', callId, name: message.name, input: message.input ?? {} });
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      for (const [callId, call] of calls) if (call.socket === socket) calls.delete(callId);
    });
  });
  // Only this user may connect: private from the moment the socket exists.
  const umask = process.umask(0o077);
  try {
    server.listen(socketPath, () => {
      try {
        chmodSync(socketPath, 0o600);
      } catch {}
    });
  } finally {
    process.umask(umask);
  }
  return {
    socketPath,
    result(callId, result) {
      const call = calls.get(callId);
      if (!call) return;
      calls.delete(callId);
      call.socket.write(JSON.stringify({ type: 'result', id: call.id, result }) + '\n');
    },
    close() {
      server.close();
      rmSync(socketPath, { force: true });
    },
  };
}

function write(input) {
  if (!child) throw new Error('Not open.');
  child.stdin.write(JSON.stringify(input) + '\n');
}

function sessionName(title) {
  const name = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return name ? `browser-click: ${name}` : 'browser-click';
}

function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // Not installed through install.mjs: fall back to defaults.
  }
  return {
    claudePath: typeof stored.claudePath === 'string' ? stored.claudePath : 'claude',
    threadsDir: typeof stored.threadsDir === 'string' ? stored.threadsDir : join(homedir(), 'browser-click-threads'),
  };
}

/** Native messaging framing: a 32-bit length in native byte order, then UTF-8 JSON. */
function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) {
    process.stderr.write(`browser-click host: dropped a ${body.length}-byte ${message.type} message\n`);
    return;
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function readNativeMessages(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) break;
      const body = buffer.subarray(4, 4 + length).toString('utf8');
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(body));
    }
  });
}
