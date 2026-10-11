import { Readability } from '@mozilla/readability';

/** What the Assistant is told about the page a Selection came from. */
export interface PageContext {
  title: string;
  url: string;
  /** The page's readable text, capped at MAX_PAGE_TEXT_CHARS. */
  text: string;
  /** True when `text` was cut off for length. */
  truncated: boolean;
}

/** About 7,500 tokens of page text per Selection. */
export const MAX_PAGE_TEXT_CHARS = 30_000;

/** Readability output shorter than this is treated as a failed parse. */
const MIN_READABLE_CHARS = 200;

/**
 * Reads the title, URL and main text of the top-level document. Tries Mozilla
 * Readability first and falls back to the page's visible text. Embedded frames
 * are not read.
 */
export function extractPageContext(doc: Document): PageContext {
  let text = readableText(doc);
  let complete = true;
  if (text.length < MIN_READABLE_CHARS) ({ text, complete } = visibleText(doc));

  let truncated = !complete;
  if (text.length > MAX_PAGE_TEXT_CHARS) {
    truncated = true;
    text = text.slice(0, MAX_PAGE_TEXT_CHARS);
    // Prefer to stop at a word boundary.
    const boundary = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'));
    if (boundary > MAX_PAGE_TEXT_CHARS * 0.95) text = text.slice(0, boundary);
    text = text.trimEnd();
  }

  return { title: doc.title.trim(), url: doc.URL, text, truncated };
}

function readableText(doc: Document): string {
  try {
    // Readability modifies the document it is given.
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    return normalize(article?.textContent ?? '');
  } catch {
    return '';
  }
}

const SKIPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED',
  'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'BROWSER-CLICK-PANEL', 'BROWSER-CLICK-OVERLAY',
]);

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The text a reader can see, roughly as `innerText` would give it. Stops once
 * it has more than enough; `complete` is false when it stopped early.
 */
function visibleText(doc: Document): { text: string; complete: boolean } {
  const parts: string[] = [];
  const view = doc.defaultView;
  // Enough raw text to fill the cap after whitespace is collapsed, and to know it overflowed.
  const enough = MAX_PAGE_TEXT_CHARS * 2;
  let length = 0;

  const walk = (node: Node) => {
    if (length > enough) return;
    if (node.nodeType === TEXT_NODE) {
      const text = node.textContent ?? '';
      parts.push(text);
      length += text.length;
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toUpperCase();
    if (SKIPPED_TAGS.has(tag) || isHidden(element, view)) return;
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push('\n');
    for (const child of element.childNodes) walk(child);
    if (block) parts.push('\n');
  };

  if (doc.body) walk(doc.body);
  return { text: normalize(parts.join('')), complete: length <= enough };
}

function isHidden(element: Element, view: Window | null): boolean {
  if ((element as HTMLElement).hidden || element.getAttribute('aria-hidden') === 'true') return true;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden';
}

/** Collapse runs of spaces within lines and drop blank lines. */
function normalize(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
