import { useEffect, useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, loadSettings, MODELS, saveSettings, type Settings } from '@/lib/settings';

const storage = browser.storage.local;

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

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

  return (
    <main className="options">
      <h1>browser-click</h1>
      <p className="lead">
        Click the toolbar icon, drag over the part of the page that confuses you, and ask Claude about it.
      </p>

      <form onSubmit={onSubmit}>
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
