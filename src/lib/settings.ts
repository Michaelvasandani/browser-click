/** User settings, kept in local (not synced) extension storage. */

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best answers' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster, cheaper' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, cheapest' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

/** How browser-click reaches Claude: the user's API key, or their own Claude Code. */
export type Backend = 'api' | 'claude-code';

export interface Settings {
  backend: Backend;
  apiKey: string;
  model: ModelId;
  /** Let the Assistant search the web (billed per search). */
  webSearch: boolean;
  /** Let the Assistant draw Marks over the page (Claude Code backend only). */
  drawOnPage: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'api',
  apiKey: '',
  model: 'claude-opus-5-5',
  webSearch: true,
  drawOnPage: true,
};

/** The subset of a chrome.storage area that settings need. */
export interface SettingsStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const KEYS = Object.keys(DEFAULT_SETTINGS);

export async function loadSettings(storage: SettingsStorage): Promise<Settings> {
  const stored = await storage.get(KEYS);
  return {
    backend: stored.backend === 'claude-code' ? 'claude-code' : DEFAULT_SETTINGS.backend,
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : DEFAULT_SETTINGS.apiKey,
    model: MODELS.some((m) => m.id === stored.model) ? (stored.model as ModelId) : DEFAULT_SETTINGS.model,
    webSearch: typeof stored.webSearch === 'boolean' ? stored.webSearch : DEFAULT_SETTINGS.webSearch,
    drawOnPage: typeof stored.drawOnPage === 'boolean' ? stored.drawOnPage : DEFAULT_SETTINGS.drawOnPage,
  };
}

export async function saveSettings(storage: SettingsStorage, changes: Partial<Settings>): Promise<void> {
  const items: Record<string, unknown> = { ...changes };
  if (typeof changes.apiKey === 'string') items.apiKey = changes.apiKey.trim();
  await storage.set(items);
}
