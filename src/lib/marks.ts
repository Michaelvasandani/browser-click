/**
 * The Marks layer: browser-click's own element above the page, where Marks are
 * drawn. It covers the viewport, lets every pointer event through to the page
 * and changes nothing on the page itself. Its shadow root keeps the page's
 * styles off the Marks.
 */

/** Space between a box and the element it surrounds. */
const BOX_PADDING = 4;

const LAYER_CSS = `
.mark {
  position: absolute;
  box-sizing: border-box;
  border: 3px solid #d97757;
  border-radius: 6px;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85), 0 2px 10px rgba(0, 0, 0, 0.25);
}`;

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class MarksLayer {
  private host: HTMLElement;
  private root: ShadowRoot;

  constructor(private readonly doc: Document) {
    this.host = doc.createElement('browser-click-marks');
    // Inline, so page styles can't make it catch clicks or push it under the page.
    Object.assign(this.host.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
      display: 'block',
    });
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = LAYER_CSS;
    this.root.append(style);
    doc.documentElement.append(this.host);
  }

  /** Draw a box around a rectangle of the viewport. */
  box(rect: ViewportRect) {
    if (!this.host.isConnected) this.doc.documentElement.append(this.host);
    const mark = this.doc.createElement('div');
    mark.className = 'mark';
    mark.dataset.mark = 'box';
    Object.assign(mark.style, {
      left: `${rect.left - BOX_PADDING}px`,
      top: `${rect.top - BOX_PADDING}px`,
      width: `${rect.width + BOX_PADDING * 2}px`,
      height: `${rect.height + BOX_PADDING * 2}px`,
    });
    this.root.append(mark);
  }

  /** Remove every Mark. Returns true if there were any. */
  clear(): boolean {
    const marks = this.root.querySelectorAll('[data-mark]');
    marks.forEach((mark) => mark.remove());
    return marks.length > 0;
  }

  /** Take the layer off the page. */
  remove() {
    this.host.remove();
  }
}
