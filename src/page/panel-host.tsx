import { createRoot, type Root } from 'react-dom/client';
import { placePanel } from '@/lib/placement';
import type { CapturedImage } from './overlay';
import { Panel } from './panel/Panel';
import panelCss from './panel/panel.css?inline';
import { PanelStore } from './store';

const PANEL_WIDTH = 380;
const ESTIMATED_PANEL_HEIGHT = 420;

/**
 * The Panel's element on the page: a fixed-position host whose Shadow DOM
 * keeps the page's styles out of the React UI.
 */
export class PanelHost {
  private host: HTMLElement;
  private frame: HTMLDivElement;
  private root: Root;
  readonly store: PanelStore;

  constructor(firstSelection: CapturedImage, onClose: () => void) {
    this.store = new PanelStore(firstSelection);
    this.host = document.createElement('browser-click-panel');
    const shadow = this.host.attachShadow({ mode: 'closed' });
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
    this.frame.style.left = `${position.left}px`;
    this.frame.style.top = `${position.top}px`;

    document.documentElement.append(this.host);
    this.root = createRoot(this.frame);
    this.root.render(<Panel store={this.store} onClose={onClose} />);
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

  destroy() {
    this.root.unmount();
    this.host.remove();
  }
}
