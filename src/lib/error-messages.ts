import type { ModelErrorKind } from './conversation';

/** Plain words for a failed model call, for the cases the user can act on. */
export function describeError(kind: ModelErrorKind, apiMessage: string): string {
  switch (kind) {
    case 'web_search':
      return `Anthropic rejected the web search tool (“${apiMessage}”). Turn web search off in browser-click's options, or ask your Anthropic organization's admin to enable it.`;
    default:
      return apiMessage;
  }
}
