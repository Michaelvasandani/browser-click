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

const ACCESS_LOST_NOTICE =
  'browser-click lost access to this tab. Click its toolbar icon to add your Selection to this Conversation.';

/** Wires the page code together: Selection Mode, the Panel and the Background. */
export function startPage() {
  let panel: PanelHost | null = null;
  let selecting = false;
  // Set when "Add selection" could not capture the tab. The next toolbar click
  // (which restores access) then adds to this Conversation instead of replacing it.
  let resumeAfterAccessLost = false;

  browser.runtime.onMessage.addListener((message: BackgroundToPageMessage) => {
    if (message.type !== 'begin-selection') return;
    const fresh = message.fresh && !(resumeAfterAccessLost && panel);
    void beginSelection(fresh, message.settings);
  });

  function closePanel() {
    panel?.destroy();
    panel = null;
    resumeAfterAccessLost = false;
  }

  function addSelection() {
    if (panel) void beginSelection(false, null);
  }

  async function beginSelection(fresh: boolean, settings: PageSettings | null) {
    if (selecting) return;
    selecting = true;
    const panelWasVisible = panel?.visible ?? false;
    const restorePanel = () => {
      if (panelWasVisible) panel?.show();
    };
    try {
      await runSelection(fresh, settings, panelWasVisible, restorePanel);
    } catch (error) {
      // Never leave the Panel hidden with its Conversation inside.
      restorePanel();
      panel?.store.setNotice(`Couldn't make that Selection: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      selecting = false;
    }
  }

  async function runSelection(
    fresh: boolean,
    settings: PageSettings | null,
    panelWasVisible: boolean,
    restorePanel: () => void,
  ) {
    if (panelWasVisible) {
      // Keep the Panel out of the still.
      panel!.hide();
      await nextFrames(2);
    }
    const capture = await requestCapture();
    if (!capture.ok) {
      restorePanel();
      if (panel && !fresh) {
        resumeAfterAccessLost = true;
        panel.store.setNotice(ACCESS_LOST_NOTICE);
      }
      return;
    }
    const image = await runSelectionMode(capture.dataUrl);
    if (!image) {
      restorePanel();
      return;
    }
    // Read per Selection, so one made after in-page navigation carries the new page.
    const pageContext = extractPageContext(document);
    if (fresh || !panel) {
      // Only the toolbar click carries settings; an "Add selection" whose
      // Panel was closed meanwhile has nowhere to go.
      if (!settings) return;
      closePanel();
      panel = new PanelHost(image, pageContext, settings, portModelClient, {
        onClose: closePanel,
        onAddSelection: addSelection,
      });
    } else {
      resumeAfterAccessLost = false;
      panel.store.setNotice(null);
      panel.store.addSelection(image, pageContext);
      panel.show();
      panel.focusQuestion();
    }
  }

  return {
    /** Remove everything this copy of the page code added to the page. */
    dispose() {
      closePanel();
    },
  };
}

async function requestCapture(): Promise<CaptureResponse> {
  const message: PageToBackgroundMessage = { type: 'capture' };
  try {
    return await browser.runtime.sendMessage(message);
  } catch (error) {
    // The extension was reloaded or updated since this page code was injected.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function nextFrames(count: number) {
  return new Promise<void>((resolve) => {
    const step = (remaining: number) =>
      remaining === 0 ? resolve() : requestAnimationFrame(() => step(remaining - 1));
    step(count);
  });
}
