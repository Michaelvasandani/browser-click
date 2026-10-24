// Registers browser-click's native messaging host with Chrome, so the
// extension can answer through your own Claude Code.
//
//   npm run install-host -- --extension-id <id> [--threads-dir <folder>] [--claude-path <path>]
//
// The extension ID is shown on browser-click's options page and on its card in
// chrome://extensions. Run this again if you move the repo or reinstall Node.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HOST_NAME = 'com.browser_click.claude_code';

const { values } = parseArgs({
  options: {
    'extension-id': { type: 'string' },
    'threads-dir': { type: 'string', default: join(homedir(), 'browser-click-threads') },
    'claude-path': { type: 'string' },
  },
});

const extensionId = values['extension-id'];
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  fail('Pass the extension ID from browser-click\'s options page: npm run install-host -- --extension-id <id>');
}

const manifestDirs = {
  darwin: [join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts')],
  linux: [join(homedir(), '.config/google-chrome/NativeMessagingHosts')],
}[platform()];
if (!manifestDirs) fail(`The Claude Code backend supports macOS and Linux, not ${platform()} yet.`);

const claudePath = values['claude-path'] ? resolve(values['claude-path']) : findClaude();
if (!claudePath || !existsSync(claudePath)) {
  fail(
    'Could not find `claude`. Install Claude Code (https://claude.com/claude-code), or pass its location: ' +
      'npm run install-host -- --extension-id <id> --claude-path "$(which claude)"',
  );
}
// A claude installed through npm is a Node script: run the host with the Node
// installed next to it, which is one claude supports.
const nodePath = existsSync(join(dirname(claudePath), 'node')) ? join(dirname(claudePath), 'node') : process.execPath;

const hostScript = resolve(dirname(fileURLToPath(import.meta.url)), 'host.mjs');
const configDir = join(homedir(), '.browser-click');
const launcher = join(configDir, 'native-host');
const threadsDir = resolve(values['threads-dir']);
mkdirSync(configDir, { recursive: true });
mkdirSync(threadsDir, { recursive: true });

writeFileSync(join(configDir, 'host-config.json'), JSON.stringify({ claudePath, threadsDir }, null, 2) + '\n');
// Chrome runs the host with no arguments and a minimal environment, so pin the Node binary.
writeFileSync(launcher, `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(hostScript)} "$@"\n`);
chmodSync(launcher, 0o755);

const manifest = {
  name: HOST_NAME,
  description: 'browser-click: answers through your Claude Code',
  path: launcher,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
for (const dir of manifestDirs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${HOST_NAME}.json`), JSON.stringify(manifest, null, 2) + '\n');
}

console.log(`Installed the browser-click host for extension ${extensionId}.
  claude:    ${claudePath}
  Node:      ${nodePath}
  Threads:   ${threadsDir}  (resume one with: cd "${threadsDir}" && claude --resume)
Reload browser-click in chrome://extensions, then click "Check Claude Code" on its options page.`);

/** claude on the PATH, else the usual install locations, including nvm's (newest Node first). */
function findClaude() {
  try {
    const found = execFileSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim();
    if (found.startsWith('/')) return found;
  } catch {
    // Not on this shell's PATH: nvm may not be loaded here.
  }
  const nvmDir = join(process.env.NVM_DIR || join(homedir(), '.nvm'), 'versions', 'node');
  const nvmVersions = existsSync(nvmDir)
    ? readdirSync(nvmDir).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    : [];
  const candidates = [
    join(homedir(), '.local/bin/claude'),
    join(homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    ...nvmVersions.map((version) => join(nvmDir, version, 'bin/claude')),
  ];
  return candidates.find((path) => existsSync(path));
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
