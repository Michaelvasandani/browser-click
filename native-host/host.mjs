// browser-click's native messaging host: Chrome starts one copy per open
// Conversation, and it runs one long-lived `claude -p` process for it.
// Messages from Chrome go to claude's stdin as stream-json; claude's stream-json
// output comes back as native messages. The host exits when claude does or
// when Chrome disconnects. Plain Node, no dependencies: it runs from this folder.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CONFIG_PATH = join(homedir(), '.browser-click', 'host-config.json');

/** Chrome rejects native messages over 1 MB from the host. */
const MAX_MESSAGE_BYTES = 1024 * 1024;

/** claude output types the extension uses. Tool results ("user") can be large and are not needed. */
const FORWARDED_TYPES = new Set(['system', 'stream_event', 'assistant', 'result']);

const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-]*$/i;

const config = loadConfig();
// Chrome starts the host with a minimal PATH. A claude installed through npm is
// a Node script, so the Node running this host must be findable.
const env = { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(':') };

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let child = null;
let stderrTail = '';

readNativeMessages(process.stdin, (message) => {
  try {
    handle(message);
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
process.stdin.on('end', () => {
  child?.kill();
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
function open({ model, webSearch, systemPrompt, title, sessionId, resume }) {
  if (child) throw new Error('Already open.');
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) throw new Error('Invalid model.');
  if (typeof systemPrompt !== 'string') throw new Error('Missing system prompt.');
  const id = typeof sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : randomUUID();
  mkdirSync(config.threadsDir, { recursive: true });

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', model,
    '--effort', 'low',
    '--system-prompt', systemPrompt,
    // Claude Code is a coding agent: give it nothing but web search, and none of
    // the user's settings, hooks, CLAUDE.md files or MCP servers.
    '--tools', webSearch ? 'WebSearch' : '',
    ...(webSearch ? ['--allowedTools', 'WebSearch'] : []),
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
    send({ type: 'exit', code, signal, stderr: stderrTail.trim() });
    // Let the exit message reach Chrome before going away.
    process.stdout.write('', () => process.exit(0));
  });
  send({ type: 'opened', sessionId: id });
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

function readLines(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) onLine(line);
    }
  });
}
