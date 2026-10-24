import { useEffect, useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';
import type { CheckClaudeCodeRequest, ClaudeCodeCheck } from '@/lib/messages';
import { DEFAULT_SETTINGS, loadSettings, MODELS, saveSettings, type Backend, type Settings } from '@/lib/settings';

const storage = browser.storage.local;

const BACKENDS: { id: Backend; label: string; note: string }[] = [
  { id: 'api', label: 'Anthropic API key', note: 'Billed to your Anthropic Console account. Nothing to install.' },
  {
    id: 'claude-code',
    label: 'Claude Code',
    note: 'Uses your Claude Code sign-in and usage. Needs Claude Code and a small local helper.',
  },
];

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState<ClaudeCodeCheck | 'checking' | null>(null);

  useEffect(() => {
    loadSettings(storage).then(setSettings);
  }, []);

  if (!settings) return null;

  const update = (changes: Partial<Settings>) => {
    setSettings({ ...settings, ...changes });
    setSaved(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await saveSettings(storage, settings);
    setSettings(await loadSettings(storage));
    setSaved(true);
  };

  const checkClaudeCode = async () => {
    setCheck('checking');
    const request: CheckClaudeCodeRequest = { type: 'check-claude-code' };
    setCheck(await browser.runtime.sendMessage(request));
  };

  return (
    <main className="options">
      <h1>browser-click</h1>
      <p className="lead">
        Click the toolbar icon, drag over the part of the page that confuses you, and ask Claude about it.
      </p>

      <form onSubmit={onSubmit}>
        <section>
          <span className="label">Answer with</span>
          <div className="models" role="radiogroup" aria-label="Answer with">
            {BACKENDS.map((backend) => (
              <label key={backend.id} className="model">
                <input
                  type="radio"
                  name="backend"
                  value={backend.id}
                  checked={settings.backend === backend.id}
                  onChange={() => update({ backend: backend.id })}
                />
                <span>
                  {backend.label}
                  <small>{backend.note}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        {settings.backend === 'claude-code' && (
          <section>
            <span className="label">Claude Code setup</span>
            <ol className="hint steps">
              <li>
                Install Claude Code and sign in: run <code>claude auth login</code> in a terminal.
              </li>
              <li>
                In the browser-click folder, run:
                <pre>npm run install-host -- --extension-id {browser.runtime.id}</pre>
              </li>
              <li>Click Check below.</li>
            </ol>
            <div className="actions">
              <button type="button" className="secondary" onClick={checkClaudeCode} disabled={check === 'checking'}>
                Check Claude Code
              </button>
              {check && check !== 'checking' && (
                <span className="hint" role="status">
                  {!check.ok
                    ? `Not working yet: ${check.message}`
                    : check.loggedIn
                      ? `Ready: Claude Code ${check.version}.`
                      : 'Claude Code is installed but not signed in. Run claude auth login.'}
                </span>
              )}
            </div>
            <p className="hint">
              Each Conversation is saved as a Claude Code session in <code>~/browser-click-threads</code> (unless you
              chose another folder). Run <code>claude --resume</code> there to pick one up. Requests go to Anthropic
              through Claude Code, not straight from this browser.
            </p>
          </section>
        )}

        {settings.backend === 'api' && (
          <section>
            <label htmlFor="api-key">Anthropic API key</label>
            <div className="key-row">
              <input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={settings.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
              <button type="button" className="secondary" onClick={() => setShowKey(!showKey)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="hint">
              Create one in the{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                Anthropic Console
              </a>
              . It is stored only in this browser's local extension storage, never synced and never given to the web
              pages you visit. Requests go straight from this extension to Anthropic and are billed to your account.
            </p>
          </section>
        )}

        <section>
          <span className="label">Model</span>
          <div className="models" role="radiogroup" aria-label="Model">
            {MODELS.map((model) => (
              <label key={model.id} className="model">
                <input
                  type="radio"
                  name="model"
                  value={model.id}
                  checked={settings.model === model.id}
                  onChange={() => update({ model: model.id })}
                />
                <span>
                  {model.label}
                  {model.id === DEFAULT_SETTINGS.model && <em> (default)</em>}
                  <small>{model.note}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <span className="label">Web search</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.webSearch}
              onChange={(e) => update({ webSearch: e.target.checked })}
            />
            <span>
              <strong>Let Claude search the web</strong>
              <small className="hint">
                When the page and Claude's own knowledge aren't enough, Claude can run up to 3 web searches per answer
                and list its sources. Anthropic bills each search on top of token costs. Turn this off to cap cost and
                latency.
              </small>
            </span>
          </label>
        </section>

        <div className="actions">
          <button type="submit">Save</button>
          {saved && (
            <span className="saved" role="status">
              Saved
            </span>
          )}
        </div>
      </form>
    </main>
  );
}
