import { browser } from 'wxt/browser';
import { ModelError, type ModelClient, type ModelStreamItem, type StreamParams } from '@/lib/conversation';
import { MODEL_PORT, type ModelPortMessage, type ModelPortRequest } from '@/lib/messages';

/** A model client that streams through the Background, which holds the API key. */
export const portModelClient: ModelClient = {
  async *stream(params: StreamParams, signal: AbortSignal): AsyncIterable<ModelStreamItem> {
    const port = browser.runtime.connect({ name: MODEL_PORT });
    const queue: ModelPortMessage[] = [];
    let wake: (() => void) | null = null;
    let disconnected = false;
    const notify = () => {
      wake?.();
      wake = null;
    };

    port.onMessage.addListener((message: ModelPortMessage) => {
      queue.push(message);
      notify();
    });
    port.onDisconnect.addListener(() => {
      disconnected = true;
      notify();
    });
    const onAbort = () => {
      port.disconnect();
      notify();
    };
    signal.addEventListener('abort', onAbort);

    try {
      const request: ModelPortRequest = { type: 'start', params };
      port.postMessage(request);
      while (true) {
        if (signal.aborted) return;
        const message = queue.shift();
        if (!message) {
          if (disconnected) throw new ModelError('network', 'Lost the connection to the extension.');
          await new Promise<void>((resolve) => (wake = resolve));
          continue;
        }
        if (message.type === 'item') yield message.item;
        else if (message.type === 'error') throw new ModelError(message.kind, message.message);
        else return;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (!disconnected) port.disconnect();
    }
  },
};
