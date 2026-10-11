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
