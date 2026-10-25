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
  // How far the page is scrolled down. `data-rect` gives where an element sits
  // before any scrolling; scrollIntoView brings the element's top to the top
  // of the viewport.
  let scrollY = 0;
  const boxOf = (element: Element) =>
    element.hasAttribute('data-rect') ? parseBox(element.getAttribute('data-rect')!) : DEFAULT_RECT;
  window.Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = boxOf(this);
    return new window.DOMRect(box.left, box.top - scrollY, box.width, box.height);
  };
  window.Element.prototype.scrollIntoView = function (this: Element) {
    scrollY = boxOf(this).top;
  };
  return window.document;
}

function parseBox(value: string): Box {
  const [left = 0, top = 0, width = 0, height = 0] = value.split(',').map(Number);
  return { left, top, width, height };
}

/** The Marks drawn on the document, as the boxes they occupy in the viewport. */
export function marksOn(doc: Document): (Box & { pointerEvents: string })[] {
  const layer = doc.querySelector<HTMLElement>('browser-click-marks');
  const root = layer?.shadowRoot;
  if (!layer || !root) return [];
  return [...root.querySelectorAll<HTMLElement>('[data-mark]')].map((mark) => ({
    left: parseFloat(mark.style.left),
    top: parseFloat(mark.style.top),
    width: parseFloat(mark.style.width),
    height: parseFloat(mark.style.height),
    pointerEvents: layer.style.pointerEvents,
  }));
}
