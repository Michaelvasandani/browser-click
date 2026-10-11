import type Anthropic from '@anthropic-ai/sdk';
import type { ModelId } from './settings';

export const MAX_SEARCHES_PER_ANSWER = 3;

/**
 * The newest web search tool each selectable model accepts. Opus 5.5 and
 * Sonnet 5.5 take `web_search_20260209` (dynamic filtering of results);
 * Haiku 5.5 is not documented for it, so it gets the basic version that
 * every model with web search accepts.
 */
const TOOL_VERSION = {
  'claude-opus-5-5': 'web_search_20260209',
  'claude-sonnet-5-5': 'web_search_20260209',
  'claude-haiku-5-5': 'web_search_20250305',
} as const satisfies Record<ModelId, string>;

export type WebSearchTool = Anthropic.WebSearchTool20260209 | Anthropic.WebSearchTool20250305;

export function webSearchTool(model: ModelId): WebSearchTool {
  return { type: TOOL_VERSION[model], name: 'web_search', max_uses: MAX_SEARCHES_PER_ANSWER };
}
