import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { classifyError } from './errors';

const headers = new Headers();
const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, headers);

describe('classifyError: web search', () => {
  it('recognises the API rejecting the web search tool', () => {
    const error = apiError(400, 'invalid_request_error', 'Web search is not enabled for this organization.');
    expect(classifyError(error, { webSearch: true })).toEqual({
      kind: 'web_search',
      message: 'Web search is not enabled for this organization.',
    });
  });

  it('recognises an unsupported web search tool version', () => {
    const error = apiError(400, 'invalid_request_error', "tools.0: 'web_search_20260209' is not supported for this model");
    expect(classifyError(error, { webSearch: true }).kind).toBe('web_search');
  });

  it('does not blame web search when it was not in the request', () => {
    const error = apiError(400, 'invalid_request_error', 'Web search is not enabled for this organization.');
    expect(classifyError(error, { webSearch: false }).kind).toBe('api');
  });

  it('does not blame web search for unrelated bad requests', () => {
    const error = apiError(400, 'invalid_request_error', 'messages.0.content: image too large');
    expect(classifyError(error, { webSearch: true })).toEqual({
      kind: 'api',
      message: 'messages.0.content: image too large',
    });
  });
});

describe('classifyError', () => {
  it('recognises an invalid API key', () => {
    expect(classifyError(apiError(401, 'authentication_error', 'invalid x-api-key'), { webSearch: false })).toEqual({
      kind: 'auth',
      message: 'invalid x-api-key',
    });
  });

  it('recognises a rate limit', () => {
    expect(classifyError(apiError(429, 'rate_limit_error', 'Number of requests exceeded'), { webSearch: false }).kind).toBe(
      'rate_limit',
    );
  });

  it('recognises a network failure', () => {
    const error = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(classifyError(error, { webSearch: false })).toEqual({ kind: 'network', message: 'Connection error.' });
  });

  it('treats a timeout as a network failure', () => {
    const error = new Anthropic.APIConnectionTimeoutError();
    expect(classifyError(error, { webSearch: false }).kind).toBe('network');
  });

  it("passes any other API error through with the API's own message", () => {
    expect(classifyError(apiError(529, 'overloaded_error', 'Overloaded'), { webSearch: true })).toEqual({
      kind: 'api',
      message: 'Overloaded',
    });
  });

  it('passes unexpected errors through', () => {
    expect(classifyError(new TypeError('boom'), { webSearch: false })).toEqual({ kind: 'api', message: 'boom' });
  });
});
