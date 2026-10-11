import { describe, expect, it } from 'vitest';
import { MODELS } from './settings';
import { MAX_SEARCHES_PER_ANSWER, webSearchTool } from './web-search';

describe('webSearchTool', () => {
  it.each(MODELS.map((m) => m.id))('sends %s the newest web search tool, limited to 3 searches', (model) => {
    expect(webSearchTool(model)).toEqual({ type: 'web_search_20260318', name: 'web_search', max_uses: 3 });
    expect(MAX_SEARCHES_PER_ANSWER).toBe(3);
  });
});
