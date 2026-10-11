import type Anthropic from '@anthropic-ai/sdk';
import type { ModelId } from './settings';

export const MAX_SEARCHES_PER_ANSWER = 3;

/**
 * The web search tool sent with every request when web search is on.
 *
 * Checked against the live API (October 2026): Claude Opus 5.5, Sonnet 5.5 and
 * Haiku 5.5 each accept web_search_20250305, _20260209 and _20260318, so every
 * model gets the newest. It filters results with code execution before they
 * reach the model (dynamic filtering): fewer tokens, but a few seconds slower
 * than the basic _20250305 version. Re-check when adding a model.
 */
export function webSearchTool(_model: ModelId): Anthropic.WebSearchTool20260318 {
  return { type: 'web_search_20260318', name: 'web_search', max_uses: MAX_SEARCHES_PER_ANSWER };
}
