import { describe, expect, it } from 'vitest';
import { MODELS } from './settings';
import { MAX_SEARCHES_PER_ANSWER, webSearchTool } from './web-search';

describe('webSearchTool', () => {
  it('uses the dynamic-filtering version on Opus 5.5 and Sonnet 5.5', () => {
    expect(webSearchTool('claude-opus-5-5').type).toBe('web_search_20260209');
    expect(webSearchTool('claude-sonnet-5-5').type).toBe('web_search_20260209');
  });

  it('uses the basic version on Haiku 5.5', () => {
    expect(webSearchTool('claude-haiku-5-5').type).toBe('web_search_20250305');
  });

  it.each(MODELS.map((m) => m.id))('limits %s to 3 searches per answer', (model) => {
    expect(webSearchTool(model)).toMatchObject({ name: 'web_search', max_uses: 3 });
    expect(MAX_SEARCHES_PER_ANSWER).toBe(3);
  });
});
