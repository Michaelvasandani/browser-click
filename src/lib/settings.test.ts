import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, MODELS, saveSettings, type SettingsStorage } from './settings';

function fakeStorage(initial: Record<string, unknown> = {}): SettingsStorage & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) {
      Object.assign(data, items);
    },
  };
}

describe('settings', () => {
  it('offers Opus 5.5 by default, then Sonnet 5.5 and Haiku 5.5', () => {
    expect(MODELS.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(DEFAULT_SETTINGS.model).toBe('claude-opus-5-5');
  });

  it('answers through the API key by default, and keeps a Claude Code choice', async () => {
    expect(DEFAULT_SETTINGS.backend).toBe('api');
    const storage = fakeStorage();
    await saveSettings(storage, { backend: 'claude-code' });
    expect((await loadSettings(storage)).backend).toBe('claude-code');
    expect((await loadSettings(fakeStorage({ backend: 'something-else' }))).backend).toBe('api');
  });

  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.apiKey).toBe('');
  });

  it('round-trips saved settings', async () => {
    const storage = fakeStorage();
    await saveSettings(storage, { apiKey: '  sk-ant-test  ', model: 'claude-haiku-5-5' });
    expect(await loadSettings(storage)).toMatchObject({ apiKey: 'sk-ant-test', model: 'claude-haiku-5-5' });
  });

  it('keeps fields that were not part of a save', async () => {
    const storage = fakeStorage();
    await saveSettings(storage, { apiKey: 'sk-ant-test' });
    await saveSettings(storage, { model: 'claude-sonnet-5-5' });
    expect(await loadSettings(storage)).toMatchObject({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5' });
  });

  it('turns web search on by default and remembers when it is turned off', async () => {
    expect(DEFAULT_SETTINGS.webSearch).toBe(true);
    const storage = fakeStorage();
    await saveSettings(storage, { webSearch: false });
    expect((await loadSettings(storage)).webSearch).toBe(false);
  });

  it('lets the Assistant draw on the page by default and remembers when that is turned off', async () => {
    expect(DEFAULT_SETTINGS.drawOnPage).toBe(true);
    const storage = fakeStorage();
    await saveSettings(storage, { drawOnPage: false });
    expect((await loadSettings(storage)).drawOnPage).toBe(false);
    expect((await loadSettings(fakeStorage({ drawOnPage: 'yes' }))).drawOnPage).toBe(true);
  });

  it('falls back to the default model when the stored one is no longer offered', async () => {
    const storage = fakeStorage({ model: 'claude-retired-1' });
    expect((await loadSettings(storage)).model).toBe('claude-opus-5-5');
  });
});
