import { browser } from 'wxt/browser';
import type {
  BackgroundToPageMessage,
  CaptureResponse,
  PageSettings,
  PageToBackgroundMessage,
} from '@/lib/messages';
import { extractPageContext } from '@/lib/page-context';
import { portModelClient } from './model-port';
import { runSelectionMode } from './overlay';
import { PanelHost } from './panel-host';

/** Wires the page code together: Selection Mode, the Panel and the Background. */
export function startPage() {
  let panel: PanelHost | null = null;
  let selecting = false;

  browser.runtime.onMessage.addListener((message: BackgroundToPageMessage) => {
    if (message.type === 'begin-selection') void beginSelection(message.fresh, message.settings);
  });

  function closePanel() {
    panel?.destroy();
    panel = null;
  }

  async function beginSelection(fresh: boolean, settings: PageSettings) {
    if (selecting) return;
    selecting = true;
    const panelWasVisible = panel?.visible ?? false;
    try {
      if (panelWasVisible) {
        // Keep the Panel out of the still.
        panel!.hide();
        await nextFrames(2);
      }
      const capture = await requestCapture();
      if (!capture.ok) {
        if (panelWasVisible) panel!.show();
        return;
      }
      const image = await runSelectionMode(capture.dataUrl);
      if (!image) {
        if (panelWasVisible) panel!.show();
        return;
      }
      // Read per Selection, so one made after in-page navigation carries the new page.
      const pageContext = extractPageContext(document);
      if (fresh || !panel) {
        closePanel();
        panel = new PanelHost(image, pageContext, settings, portModelClient, closePanel);
      } else {
        panel.store.addSelection(image, pageContext);
        panel.show();
      }
    } finally {
      selecting = false;
    }
  }
}

function requestCapture(): Promise<CaptureResponse> {
  const message: PageToBackgroundMessage = { type: 'capture' };
  return browser.runtime.sendMessage(message);
}

function nextFrames(count: number) {
  return new Promise<void>((resolve) => {
    const step = (remaining: number) =>
      remaining === 0 ? resolve() : requestAnimationFrame(() => step(remaining - 1));
    step(count);
  });
}
