import { JSDOM } from 'jsdom';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where every element sits unless it says otherwise with `data-rect`. */
const DEFAULT_RECT: Box = { left: 10, top: 10, width: 100, height: 20 };

/**
 * A jsdom document for the page tools. jsdom has no layout, so each element
 * reports the rectangle in its `data-rect="left,top,width,height"` attribute
 * (viewport coordinates), or a small visible one by default. The viewport is
 * jsdom's 1024x768.
 */
export function pageDocument(body: string, url = 'https://example.com/settings'): Document {
  const { window } = new JSDOM(
    `<!doctype html><html><head><title>Settings</title></head><body>${body}</body></html>`,
    { url },
  );
  window.Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = this.hasAttribute('data-rect') ? parseBox(this.getAttribute('data-rect')!) : DEFAULT_RECT;
    return new window.DOMRect(box.left, box.top, box.width, box.height);
  };
  return window.document;
}

function parseBox(value: string): Box {
  const [left = 0, top = 0, width = 0, height = 0] = value.split(',').map(Number);
  return { left, top, width, height };
}

export interface MarkOnPage extends Box {
  /** box, arrow, highlight or label. */
  kind: string;
  /** The Mark's own text, such as a label's number. */
  text: string;
  /** False while the Marks layer, or this Mark, is hidden. */
  visible: boolean;
  /** The layer's pointer-events style. */
  pointerEvents: string;
}

/** Make the window report this scroll position, as a scroll would (jsdom has no layout). */
export function scrollWindow(doc: Document, x: number, y: number) {
  const view = doc.defaultView!;
  Object.defineProperty(view, 'scrollX', { value: x, configurable: true });
  Object.defineProperty(view, 'scrollY', { value: y, configurable: true });
  view.dispatchEvent(new view.Event('scroll'));
}

/** The Marks drawn on the document, as the boxes they occupy in the viewport. */
export function marksOn(doc: Document): MarkOnPage[] {
  const layer = doc.querySelector<HTMLElement>('browser-click-marks');
  const root = layer?.shadowRoot;
  if (!layer || !root) return [];
  return [...root.querySelectorAll<HTMLElement>('[data-mark]')].map((mark) => ({
    left: parseFloat(mark.style.left),
    top: parseFloat(mark.style.top),
    width: parseFloat(mark.style.width),
    height: parseFloat(mark.style.height),
    kind: mark.dataset.mark ?? '',
    text: mark.textContent ?? '',
    visible: layer.style.display !== 'none' && mark.style.display !== 'none',
    pointerEvents: layer.style.pointerEvents,
  }));
}
