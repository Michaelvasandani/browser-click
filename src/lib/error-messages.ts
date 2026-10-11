import type { ModelErrorKind } from './conversation';

/** Plain words for a failed model call, for the cases the user can act on. */
export function describeError(kind: ModelErrorKind, apiMessage: string): string {
  switch (kind) {
    case 'auth':
      return "Anthropic didn't accept your API key. Check it in browser-click's options.";
    case 'rate_limit':
      return "You've hit your Anthropic rate limit. Wait a moment, then retry.";
    case 'network':
      return "Couldn't reach Anthropic. Check your internet connection, then retry.";
    case 'web_search':
      return `Anthropic rejected the web search tool (“${apiMessage}”). Turn web search off in browser-click's options, or ask your Anthropic organization's admin to enable it.`;
    case 'api':
      return apiMessage;
  }
}

export const REFUSAL_MESSAGE =
  'Claude declined to answer this. You can rephrase your question or select something else.';
