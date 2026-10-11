import { browser, type Browser } from 'wxt/browser';
import type { BackgroundToPageMessage, CaptureResponse, PageToBackgroundMessage } from '@/lib/messages';
import { isRestrictedUrl } from '@/lib/restricted';
import { loadSettings } from '@/lib/settings';

export default defineBackground(() => {
  // Keep settings (including the API key) readable only by the extension's own
  // pages and this worker, never by the code injected into web pages.
  browser.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

  browser.action.onClicked.addListener(onActionClicked);
  // Lets the smoke-test harness stand in for a toolbar click (`wxt build --mode e2e` only).
  if (import.meta.env.MODE === 'e2e') Object.assign(globalThis, { __onActionClicked: onActionClicked });

  browser.runtime.onMessage.addListener((message: PageToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'capture') return;
    capture(sender.tab?.windowId).then(sendResponse);
    return true;
  });
});

async function onActionClicked(tab: Browser.tabs.Tab) {
  if (tab.id === undefined) return;

  const settings = await loadSettings(browser.storage.local);
  if (!settings.apiKey) {
    await browser.runtime.openOptionsPage();
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    await showCantRunHere(tab);
    return;
  }

  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/page.js'] });
  } catch {
    // Chrome refused to inject: a page extensions can't touch, such as the PDF viewer.
    await showCantRunHere(tab);
    return;
  }
  const message: BackgroundToPageMessage = { type: 'begin-selection', fresh: true };
  await browser.tabs.sendMessage(tab.id, message);
}

/** Pops up a short "can't run here" note from the toolbar icon. */
async function showCantRunHere(tab: Browser.tabs.Tab) {
  const tabId = tab.id!;
  try {
    await browser.action.setPopup({ tabId, popup: '/cant-run.html' });
    await browser.action.openPopup({ windowId: tab.windowId });
  } catch {
    // openPopup is unavailable (older Chrome): fall back to a badge and tooltip.
    await browser.action.setBadgeText({ tabId, text: '!' });
    await browser.action.setTitle({ tabId, title: "browser-click can't run on this page" });
  } finally {
    // Later clicks should reach onActionClicked again.
    await browser.action.setPopup({ tabId, popup: '' });
  }
}

async function capture(windowId: number | undefined): Promise<CaptureResponse> {
  if (windowId === undefined) return { ok: false, error: 'No tab to capture.' };
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
