import { browser, type Browser } from 'wxt/browser';
import type { BackgroundToPageMessage, CaptureResponse, PageToBackgroundMessage } from '@/lib/messages';

export default defineBackground(() => {
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
  await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/page.js'] });
  const message: BackgroundToPageMessage = { type: 'begin-selection', fresh: true };
  await browser.tabs.sendMessage(tab.id, message);
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
