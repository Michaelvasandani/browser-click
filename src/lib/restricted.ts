const BLOCKED_SCHEMES = ['chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-untrusted:', 'devtools:', 'view-source:', 'about:', 'edge:'];

/**
 * Pages Chrome never lets extensions script. The built-in PDF viewer is not
 * recognisable by URL; injection fails there and is handled the same way.
 */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (BLOCKED_SCHEMES.includes(parsed.protocol)) return true;
  if (parsed.hostname === 'chromewebstore.google.com') return true;
  return parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore');
}
