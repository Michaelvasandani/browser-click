/**
 * The Marks layer: browser-click's own element above the page, where Marks are
 * drawn. It covers the viewport, lets every pointer event through to the page
 * and changes nothing on the page itself. Its shadow root keeps the page's
 * styles off the Marks.
 *
 * Marks stay with what they point at: an element-anchored Mark follows its
 * element as the page (or any scroller in it) scrolls and as the window
 * resizes, and a Mark at an area of the page follows the page's own scrolling.
 */

export type MarkKind = 'box' | 'arrow' | 'highlight' | 'label';

export const MARK_KINDS: readonly MarkKind[] = ['box', 'arrow', 'highlight', 'label'];

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a Mark points at: an element of the page, or an area of the visible page in viewport coordinates. */
export type MarkAnchor = { element: Element } | { area: ViewportRect };

/** Space between a box and the element it surrounds. */
const BOX_PADDING = 4;
/** An arrow's size, and the space between its tip and what it points at. */
const ARROW = { width: 44, height: 24, gap: 4 };
/** A numbered label's diameter. */
const LABEL_SIZE = 24;

const ACCENT = '#d97757';

const LAYER_CSS = `
.mark {
  position: absolute;
  box-sizing: border-box;
}
.mark[data-mark="box"] {
  border: 3px solid ${ACCENT};
  border-radius: 6px;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85), 0 2px 10px rgba(0, 0, 0, 0.25);
}
.mark[data-mark="highlight"] {
  background: rgba(255, 214, 10, 0.38);
  border-radius: 3px;
  mix-blend-mode: multiply;
}
.mark[data-mark="arrow"] svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35));
}
.mark[data-mark="arrow"][data-from="right"] svg {
  transform: scaleX(-1);
}
.mark[data-mark="label"] {
  border-radius: 50%;
  background: ${ACCENT};
  color: #fff;
  border: 2px solid #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font: 600 13px/20px system-ui, -apple-system, sans-serif;
  text-align: center;
}`;

/** An arrow pointing right, its tip at the right edge of its box. */
const ARROW_SVG = `<svg viewBox="0 0 44 24" aria-hidden="true"><path d="M2 12 H30 M24 4 L36 12 L24 20" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12 H30 M24 4 L36 12 L24 20" fill="none" stroke="${ACCENT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

interface DrawnMark {
  node: HTMLElement;
  kind: MarkKind;
  /** Where the Mark's target is in the viewport now, or null if it left the page. */
  target: () => ViewportRect | null;
}

export class MarksLayer {
  private host: HTMLElement;
  private root: ShadowRoot;
  private marks: DrawnMark[] = [];
  private hidden = false;
  private readonly follow = () => this.place();

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
    const view = doc.defaultView!;
    // Capture, so scrolling inside any scroller on the page is followed too.
    view.addEventListener('scroll', this.follow, { capture: true, passive: true });
    view.addEventListener('resize', this.follow, { passive: true });
  }

  /** Draw a Mark at an element or an area of the viewport. `number` is a label's text. */
  draw(kind: MarkKind, anchor: MarkAnchor, number?: number) {
    if (!this.host.isConnected) this.doc.documentElement.append(this.host);
    const node = this.doc.createElement('div');
    node.className = 'mark';
    node.dataset.mark = kind;
    if (kind === 'arrow') node.innerHTML = ARROW_SVG;
    if (kind === 'label') node.textContent = String(number ?? '');
    this.root.append(node);
    const mark = { node, kind, target: this.targetOf(anchor) };
    this.marks.push(mark);
    this.placeMark(mark);
  }

  /** Hide every Mark (as during Selection Mode), or show them again. Marks drawn meanwhile stay hidden too. */
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.host.style.display = hidden ? 'none' : 'block';
    if (!hidden) this.place();
  }

  /** Remove every Mark. Returns true if there were any. */
  clear(): boolean {
    const had = this.marks.length > 0;
    for (const mark of this.marks) mark.node.remove();
    this.marks = [];
    return had;
  }

  /** Take the layer off the page. */
  remove() {
    this.clear();
    const view = this.doc.defaultView;
    view?.removeEventListener('scroll', this.follow, { capture: true });
    view?.removeEventListener('resize', this.follow);
    this.host.remove();
  }

  private targetOf(anchor: MarkAnchor): () => ViewportRect | null {
    if ('element' in anchor) {
      const { element } = anchor;
      return () => (element.isConnected ? element.getBoundingClientRect() : null);
    }
    // Pinned to the page, so it moves with the page as it scrolls.
    const view = this.doc.defaultView!;
    const origin = { x: view.scrollX, y: view.scrollY };
    const { area } = anchor;
    return () => ({
      left: area.left + origin.x - view.scrollX,
      top: area.top + origin.y - view.scrollY,
      width: area.width,
      height: area.height,
    });
  }

  private place() {
    if (this.hidden) return;
    for (const mark of this.marks) this.placeMark(mark);
  }

  private placeMark(mark: DrawnMark) {
    const target = mark.target();
    if (!target) {
      // Its element left the page: nothing to point at any more.
      mark.node.style.display = 'none';
      return;
    }
    mark.node.style.display = '';
    const box = this.boxFor(mark, target);
    Object.assign(mark.node.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  }

  /** Where a Mark of this kind is drawn, for a target at `t`. */
  private boxFor(mark: DrawnMark, t: ViewportRect): ViewportRect {
    switch (mark.kind) {
      case 'box':
        return {
          left: t.left - BOX_PADDING,
          top: t.top - BOX_PADDING,
          width: t.width + BOX_PADDING * 2,
          height: t.height + BOX_PADDING * 2,
        };
      case 'highlight':
        return { left: t.left, top: t.top, width: t.width, height: t.height };
      case 'arrow': {
        // From the left, its tip at the target's left edge, unless there's no room there.
        const fromLeft = t.left - ARROW.gap - ARROW.width >= 0;
        mark.node.dataset.from = fromLeft ? 'left' : 'right';
        return {
          left: fromLeft ? t.left - ARROW.gap - ARROW.width : t.left + t.width + ARROW.gap,
          top: t.top + t.height / 2 - ARROW.height / 2,
          width: ARROW.width,
          height: ARROW.height,
        };
      }
      case 'label':
        // Centred on the target's top-left corner, kept inside the window.
        return {
          left: Math.max(0, t.left - LABEL_SIZE / 2),
          top: Math.max(0, t.top - LABEL_SIZE / 2),
          width: LABEL_SIZE,
          height: LABEL_SIZE,
        };
    }
  }
}
