import { createRoot, type Root } from 'react-dom/client';
import type { ModelClient } from '@/lib/conversation';
import type { PageSettings } from '@/lib/messages';
import type { PageContext } from '@/lib/page-context';
import { placePanel, type Position } from '@/lib/placement';
import type { CapturedImage } from './overlay';
import { Panel } from './panel/Panel';
import panelCss from './panel/panel.css?inline';
import { PanelStore } from './store';

const PANEL_WIDTH = 380;
// Closed, so the page's own scripts cannot read the Conversation out of the DOM.
// The smoke-test harness needs to look inside (`wxt build --mode e2e` only).
const SHADOW_MODE: ShadowRootMode = import.meta.env.MODE === 'e2e' ? 'open' : 'closed';
const ESTIMATED_PANEL_HEIGHT = 420;
const VIEWPORT_MARGIN = 12;

export interface PanelCallbacks {
  onClose: () => void;
  onAddSelection: () => void;
}

/**
 * The Panel's element on the page: a fixed-position host whose Shadow DOM
 * keeps the page's styles out of the React UI.
 */
export class PanelHost {
  private host: HTMLElement;
  private frame: HTMLDivElement;
  private shadow: ShadowRoot;
  private root: Root;
  readonly store: PanelStore;

  constructor(
    firstSelection: CapturedImage,
    pageContext: PageContext,
    settings: PageSettings,
    client: ModelClient,
    callbacks: PanelCallbacks,
  ) {
    this.store = new PanelStore(firstSelection, pageContext, settings, client);
    this.host = document.createElement('browser-click-panel');
    const shadow = this.host.attachShadow({ mode: SHADOW_MODE });
    this.shadow = shadow;
    const style = document.createElement('style');
    style.textContent = panelCss;
    this.frame = document.createElement('div');
    this.frame.className = 'panel-frame';
    shadow.append(style, this.frame);

    const position = placePanel(
      firstSelection.rect,
      { width: window.innerWidth, height: window.innerHeight },
      { width: PANEL_WIDTH, height: ESTIMATED_PANEL_HEIGHT },
    );
    this.moveTo(position);

    document.documentElement.append(this.host);
    this.root = createRoot(this.frame);
    this.root.render(<Panel store={this.store} {...callbacks} />);
  }

  /** Place the Panel, letting it grow no further than the bottom of the viewport. */
  private moveTo(position: Position) {
    this.frame.style.left = `${position.left}px`;
    this.frame.style.top = `${position.top}px`;
    this.frame.style.maxHeight = `${Math.max(200, window.innerHeight - position.top - VIEWPORT_MARGIN)}px`;
  }

  get visible() {
    return this.host.style.display !== 'none';
  }

  hide() {
    this.host.style.display = 'none';
  }

  show() {
    this.host.style.display = '';
  }

  focusQuestion() {
    this.shadow.querySelector<HTMLTextAreaElement>('.question')?.focus();
  }

  destroy() {
    this.root.unmount();
    this.host.remove();
  }
}
