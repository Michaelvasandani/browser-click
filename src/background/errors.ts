import Anthropic from '@anthropic-ai/sdk';
import type { ModelErrorKind } from '@/lib/conversation';

export interface RequestFacts {
  /** The failed request offered the web search tool. */
  webSearch: boolean;
}

/** Sorts a failed model call into the cases the Panel can explain. */
export function classifyError(error: unknown, request: RequestFacts): { kind: ModelErrorKind; message: string } {
  if (error instanceof Anthropic.AuthenticationError) return { kind: 'auth', message: apiMessage(error) };
  if (error instanceof Anthropic.RateLimitError) return { kind: 'rate_limit', message: apiMessage(error) };
  if (error instanceof Anthropic.APIConnectionError) return { kind: 'network', message: error.message };
  if (error instanceof Anthropic.APIError) {
    const message = apiMessage(error);
    // The API names the tool when it rejects it (not enabled for the
    // organization, or a version the model does not accept).
    if (request.webSearch && error.status === 400 && /web[ _-]?search/i.test(message)) {
      return { kind: 'web_search', message };
    }
    return { kind: 'api', message };
  }
  return { kind: 'api', message: error instanceof Error ? error.message : String(error) };
}

/** The API's own human-readable message, without the SDK's status prefix. */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === 'string' ? body.error.message : error.message;
}
