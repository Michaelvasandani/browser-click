import Anthropic from '@anthropic-ai/sdk';
import { browser, type Browser } from 'wxt/browser';
import { MODEL_PORT, type ModelPortMessage, type ModelPortRequest } from '@/lib/messages';
import { loadSettings } from '@/lib/settings';
import { classifyError } from './errors';

/**
 * Makes every call to the model on behalf of the page code, which streams one
 * response per port. The API key is added here and never leaves the Background.
 * No Conversation state is kept: each request carries its full history.
 */
export function listenForModelRequests() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== MODEL_PORT || port.sender?.id !== browser.runtime.id) return;
    port.onMessage.addListener((request: ModelPortRequest) => {
      if (request.type === 'start') void relay(port, request);
    });
  });
}

async function relay(port: Browser.runtime.Port, request: ModelPortRequest) {
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  const post = (message: ModelPortMessage) => {
    if (!controller.signal.aborted) port.postMessage(message);
  };

  try {
    const { apiKey } = await loadSettings(browser.storage.local);
    // dangerouslyAllowBrowser: this is the user's own key, used only from the
    // extension's service worker; the SDK then sends the header the API expects
    // for browser-originated requests (anthropic-dangerous-direct-browser-access).
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const stream = client.messages.stream(request.params, { signal: controller.signal });
    for await (const event of stream) post({ type: 'item', item: { type: 'event', event } });
    post({ type: 'item', item: { type: 'message', message: await stream.finalMessage() } });
    post({ type: 'end' });
  } catch (error) {
    if (controller.signal.aborted) return;
    const webSearch = request.params.tools?.some((tool) => 'name' in tool && tool.name === 'web_search') ?? false;
    post({ type: 'error', ...classifyError(error, { webSearch }) });
  }
}
