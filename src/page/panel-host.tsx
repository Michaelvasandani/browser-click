import { createRoot, type Root } from 'react-dom/client';
import type { ModelClient } from '@/lib/conversation';
import type { PageSettings } from '@/lib/messages';
import type { PageContext } from '@/lib/page-context';
import type { PageTools } from '@/lib/page-tools';
import { clampPanel, placePanel, type Position } from '@/lib/placement';
import type { CapturedImage } from './overlay';
import { Panel } from './panel/Panel';
import panelCss from './panel/panel.css?inline';
import { PanelStore } from './store';

const PANEL_WIDTH = 380;
const ESTIMATED_PANEL_HEIGHT = 420;
const VIEWPORT_MARGIN = 12;

export interface PanelCallbacks {
  onClose: () => void;
  onAddSelection: () => void;
}

// Keystrokes typed into the Panel must not reach the page's own shortcuts
// (YouTube's "k" to pause, "/" to search, …).
const CONTAINED_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

/**
 * The Panel's element on the page: a fixed-position host whose Shadow DOM
 * keeps the page's styles out of the React UI. It is fixed to the viewport,
 * draggable by its header and kept on screen.
 */
export class PanelHost {
  private host: HTMLElement;
  private frame: HTMLDivElement;
  private shadow: ShadowRoot;
  private root: Root;
  private position: Position = { left: 0, top: 0 };
  private readonly onResize = () => this.moveTo(this.position);
  private readonly keepAttached: MutationObserver;
  readonly store: PanelStore;

  constructor(
    firstSelection: CapturedImage,
    pageContext: PageContext,
    settings: PageSettings,
    client: ModelClient,
    pageTools: PageTools | undefined,
    callbacks: PanelCallbacks,
  ) {
    this.store = new PanelStore(firstSelection, pageContext, settings, client, pageTools);
    this.host = document.createElement('browser-click-panel');
    // Closed, so the page's own scripts cannot read the Conversation out of the DOM.
    const shadow = this.host.attachShadow({ mode: 'closed' });
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

    for (const type of CONTAINED_EVENTS) shadow.addEventListener(type, (event) => event.stopPropagation());
    this.frame.addEventListener('pointerdown', (event) => this.startDrag(event));
    window.addEventListener('resize', this.onResize);

    document.documentElement.append(this.host);
    // Some single-page apps replace parts of the document as they navigate;
    // put the Panel back if it gets swept away.
    this.keepAttached = new MutationObserver(() => {
      if (!this.host.isConnected) document.documentElement.append(this.host);
    });
    this.keepAttached.observe(document.documentElement, { childList: true });

    this.root = createRoot(this.frame);
    this.root.render(<Panel store={this.store} {...callbacks} />);
  }

  /** Place the Panel on screen, letting it grow no further than the bottom of the viewport. */
  private moveTo(position: Position) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: this.frame.offsetWidth || PANEL_WIDTH, height: this.frame.offsetHeight };
    // Keep the bottom margin free too, so moving the Panel never shrinks it.
    this.position = clampPanel(position, { ...viewport, height: viewport.height - VIEWPORT_MARGIN }, size);
    this.frame.style.left = `${this.position.left}px`;
    this.frame.style.top = `${this.position.top}px`;
    this.frame.style.maxHeight = `${Math.max(200, viewport.height - this.position.top - VIEWPORT_MARGIN)}px`;
  }

  private startDrag(event: PointerEvent) {
    const target = event.target as Element;
    if (event.button !== 0 || !target.closest('.header') || target.closest('button')) return;
    event.preventDefault();
    const handle = target.closest('.header') as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const offset = { x: event.clientX - this.position.left, y: event.clientY - this.position.top };
    this.frame.classList.add('dragging');

    const onMove = (move: PointerEvent) =>
      this.moveTo({ left: move.clientX - offset.x, top: move.clientY - offset.y });
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      this.frame.classList.remove('dragging');
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
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

  /** Close the Panel. The Conversation is discarded with it; nothing is kept. */
  destroy() {
    this.store.stop();
    this.keepAttached.disconnect();
    window.removeEventListener('resize', this.onResize);
    this.root.unmount();
    this.host.remove();
  }
}
