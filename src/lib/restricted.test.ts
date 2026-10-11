import { describe, expect, it } from 'vitest';
import { isRestrictedUrl } from './restricted';

describe('isRestrictedUrl', () => {
  it.each([
    'chrome://settings/',
    'chrome://newtab/',
    'chrome-extension://abcdefghijklmnop/options.html',
    'chrome-search://local-ntp/local-ntp.html',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com/',
    'about:blank',
    'edge://settings',
    'https://chromewebstore.google.com/detail/foo/abc',
    'https://chrome.google.com/webstore/detail/foo/abc',
  ])('blocks %s', (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'http://localhost:3000/page',
    'https://www.youtube.com/watch?v=abc',
    'https://chrome.google.com/other',
    'file:///home/me/notes.html',
  ])('allows %s', (url) => {
    expect(isRestrictedUrl(url)).toBe(false);
  });

  it('does not decide when the URL is unknown', () => {
    expect(isRestrictedUrl(undefined)).toBe(false);
  });
});
