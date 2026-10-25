import { MARK_KINDS, MarksLayer, type MarkAnchor, type MarkKind, type ViewportRect } from './marks';

/**
 * Page tools: the one definition of the tools the Assistant may call on the
 * page, shared by every Backend. The definitions (names, descriptions, input
 * schemas) are plain data the Background hands to the native host's MCP
 * server; createPageTools() runs the calls against a document.
 *
 * Every rule about what a tool may touch is enforced here, in page code, never
 * left to the model.
 */

export type PageToolName = 'look' | 'mark';

export interface PageToolDefinition {
  name: PageToolName;
  description: string;
  /** JSON Schema of the tool's input, as MCP and the Anthropic API both take it. */
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

/** A call to a page tool, as the model made it. `name` is untrusted until checked against the offered tools. */
export interface PageToolCall {
  name: string;
  input: unknown;
}

/** What a page tool returns to the model. The same shape as an MCP tool result. */
export interface PageToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Something a page tool call did that the Panel shows as a line in the answer. */
export type PageToolEffect = MarkEffect;

/**
 * A Mark was drawn. `target` names the element it points at (absent for an
 * area of the page), `area` is where that target is in the viewport, and
 * `number` is a label's number.
 */
export interface MarkEffect {
  type: 'mark';
  kind: MarkKind;
  target?: string;
  number?: number;
  area: ViewportRect;
}

export interface PageToolOutcome {
  result: PageToolResult;
  effect?: PageToolEffect;
}

/** The settings that decide which page tools are offered. */
export interface PageToolSettings {
  drawOnPage: boolean;
}

const LOOK: PageToolDefinition = {
  name: 'look',
  description:
    'List the elements of the page that are currently visible, each with a short reference (such as e3), its role and its name, plus the viewport size. Call it before pointing at anything, and again after the page changes.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

const MARK: PageToolDefinition = {
  name: 'mark',
  description:
    'Draw a Mark on the visible page, to show the reader where something is: a box around it, an arrow pointing at it, a highlight over it, or a numbered label on it (for steps: 1, then 2, then 3). Point at an element reference from the latest look; only when there is no element to point at (a spike in a chart, a spot in a video frame) give an area of the visible page in viewport pixels instead. Changes nothing on the page; Marks are cleared when the reader asks the next question.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...MARK_KINDS], description: 'The kind of Mark. Defaults to box.' },
      element: { type: 'string', description: 'An element reference from look, such as e3.' },
      area: {
        type: 'object',
        description:
          'Instead of an element: a rectangle of the visible page in viewport pixels (origin at the top-left of the viewport look reports).',
        properties: { left: { type: 'number' }, top: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
        required: ['left', 'top', 'width', 'height'],
        additionalProperties: false,
      },
      number: { type: 'integer', minimum: 1, maximum: 99, description: "A label's number. Defaults to the next one." },
    },
    additionalProperties: false,
  },
};

/** The page tools the Assistant is given under these settings. */
export function offeredPageTools(settings: PageToolSettings): PageToolDefinition[] {
  return settings.drawOnPage ? [LOOK, MARK] : [];
}

export interface PageTools {
  /** The tools offered under the current settings. A call to any other is refused. */
  readonly offered: readonly PageToolDefinition[];
  /** Runs one call. Never throws: failures and refusals come back as error results. */
  run(call: PageToolCall): Promise<PageToolOutcome>;
  /** Remove the current answer's Marks. Returns true if there were any. */
  clearMarks(): boolean;
  /** Hide the Marks (during Selection Mode, so they stay out of a new Selection), or bring them back. */
  setMarksHidden(hidden: boolean): void;
  /** Remove everything the page tools added to the page. */
  dispose(): void;
}

/**
 * browser-click's own elements on the page (the Panel, Selection Mode, the
 * Marks layer) are custom elements named with this prefix. They are never part
 * of the page as the Assistant sees it.
 */
const OWN_ELEMENT_PREFIX = 'BROWSER-CLICK-';

/** Elements worth listing by their tag: things to operate, and things that label the page. */
const NATIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'iframe',
  'img[alt]:not([alt=""])',
  'h1, h2, h3, h4, h5, h6',
  '[contenteditable=""], [contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Elements worth listing: the above, plus anything given a role of its own. */
const LISTED_SELECTOR = `${NATIVE_SELECTOR}, [role]`;

/** Roles that only group or decorate, so are not worth an entry of their own. */
const UNLISTED_ROLES = new Set(['presentation', 'none', 'generic', 'group', 'region', 'main', 'navigation', 'banner', 'contentinfo']);

const MAX_NAME_CHARS = 80;

export function createPageTools(doc: Document, settings: PageToolSettings): PageTools {
  const offered = offeredPageTools(settings);
  const refs = new Refs();
  let marks: MarksLayer | null = null;
  // The highest label number in the current answer's Marks, so labels count on by default.
  let labelsDrawn = 0;
  // Marks are hidden during Selection Mode.
  let hidden = false;

  const tools: Record<PageToolName, (input: Record<string, unknown>) => PageToolOutcome> = {
    look: () => ({ result: ok(describeVisible(doc, refs)) }),
    mark: (input) => {
      const kind = input.kind ?? 'box';
      if (!MARK_KINDS.includes(kind as MarkKind)) {
        return { result: refused(`There is no ${JSON.stringify(kind)} Mark. Use one of: ${MARK_KINDS.join(', ')}.`) };
      }
      let number: number | undefined;
      if (kind === 'label') {
        number = input.number === undefined ? labelsDrawn + 1 : Number(input.number);
        if (!Number.isInteger(number) || number < 1 || number > 99) {
          return { result: refused('A label number must be a whole number from 1 to 99.') };
        }
      }
      const where = markTarget(input, refs, viewportOf(doc));
      if ('refusal' in where) return { result: refused(where.refusal) };
      marks ??= new MarksLayer(doc);
      if (hidden) marks.setHidden(true);
      marks.draw(kind as MarkKind, where.anchor, number);
      if (kind === 'label') labelsDrawn = Math.max(labelsDrawn, number!);
      const effect: MarkEffect = { type: 'mark', kind: kind as MarkKind, area: where.area };
      if (where.target !== undefined) effect.target = where.target;
      if (number !== undefined) effect.number = number;
      const what = kind === 'label' ? `label ${number}` : String(kind);
      return { result: ok(`Drew a ${what} at ${where.described}.`), effect };
    },
  };

  return {
    offered,
    async run(call) {
      const tool = offered.find((t) => t.name === call.name);
      if (!tool) return { result: refused(`The ${JSON.stringify(call.name)} tool is not available.`) };
      try {
        const input = call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {};
        return tools[tool.name](input);
      } catch (error) {
        return { result: refused(`The ${tool.name} tool failed: ${error instanceof Error ? error.message : String(error)}`) };
      }
    },
    clearMarks() {
      labelsDrawn = 0;
      return marks?.clear() ?? false;
    },
    setMarksHidden(hide) {
      hidden = hide;
      marks?.setHidden(hide);
    },
    dispose() {
      marks?.remove();
      marks = null;
    },
  };
}

/** Short, stable references for elements: the same element keeps its reference across looks. */
class Refs {
  private byElement = new WeakMap<Element, string>();
  private byRef = new Map<string, WeakRef<Element>>();
  private next = 1;

  ref(element: Element): string {
    let ref = this.byElement.get(element);
    if (!ref) {
      ref = `e${this.next++}`;
      this.byElement.set(element, ref);
      this.byRef.set(ref, new WeakRef(element));
    }
    return ref;
  }

  /** The element a reference names, if it is still on the page. */
  element(ref: unknown): Element | undefined {
    if (typeof ref !== 'string') return undefined;
    const element = this.byRef.get(ref)?.deref();
    return element?.isConnected ? element : undefined;
  }
}

function describeVisible(doc: Document, refs: Refs): string {
  const view = doc.defaultView!;
  const viewport = { width: view.innerWidth, height: view.innerHeight };
  const lines = [`Viewport: ${viewport.width}x${viewport.height}`, 'Visible elements (reference, role, name):'];
  for (const element of doc.querySelectorAll(LISTED_SELECTOR)) {
    if (!isListed(element) || !inView(element, viewport)) continue;
    lines.push(`${refs.ref(element)} ${describeElement(element)}`);
  }
  if (lines.length === 2) lines.push('(none)');
  return lines.join('\n');
}

function describeElement(element: Element): string {
  const name = nameOf(element);
  return name ? `${roleOf(element)} ${JSON.stringify(name)}` : roleOf(element);
}

function isListed(element: Element): boolean {
  const role = element.getAttribute('role');
  if (role && UNLISTED_ROLES.has(role) && !element.matches(NATIVE_SELECTOR)) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.tagName.startsWith(OWN_ELEMENT_PREFIX)) return false;
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  }
  return true;
}

function inView(element: Element, viewport: { width: number; height: number }): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.right > 0 && rect.bottom > 0 && rect.left < viewport.width && rect.top < viewport.height;
}

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  search: 'searchbox',
};

function roleOf(element: Element): string {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') return INPUT_ROLES[(element as HTMLInputElement).type] ?? 'textbox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  const implicit: Record<string, string> = {
    a: 'link',
    button: 'button',
    summary: 'button',
    select: 'combobox',
    textarea: 'textbox',
    img: 'img',
    iframe: 'iframe',
  };
  return implicit[tag] ?? (element.hasAttribute('contenteditable') ? 'textbox' : tag);
}

/** The element's accessible name, roughly as a screen reader would say it. */
function nameOf(element: Element): string {
  const doc = element.ownerDocument;
  const labelledBy = element.getAttribute('aria-labelledby');
  const fromIds = labelledBy
    ?.split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? '')
    .join(' ');
  const labels = 'labels' in element ? [...((element as HTMLInputElement).labels ?? [])] : [];
  const candidates = [
    fromIds,
    element.getAttribute('aria-label'),
    labels.map((label) => label.textContent).join(' '),
    element.getAttribute('alt'),
    element.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes((element as HTMLInputElement).type)
      ? (element as HTMLInputElement).value
      : null,
    element.getAttribute('placeholder'),
    element.tagName === 'INPUT' || element.tagName === 'IFRAME' ? null : element.textContent,
    element.getAttribute('title'),
  ];
  for (const candidate of candidates) {
    const name = candidate?.replace(/\s+/g, ' ').trim();
    if (name) return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
  }
  return '';
}

type MarkTarget =
  | { anchor: MarkAnchor; area: ViewportRect; target?: string; described: string }
  | { refusal: string };

/** What a mark call points at: an element it looked up, or an area of the visible page. */
function markTarget(input: Record<string, unknown>, refs: Refs, viewport: { width: number; height: number }): MarkTarget {
  if (input.element !== undefined && input.area !== undefined) {
    return { refusal: 'Give either an element or an area, not both.' };
  }
  if (input.area === undefined) {
    const element = refs.element(input.element);
    if (!element) return { refusal: unknownElement(input.element) };
    return {
      anchor: { element },
      area: plainRect(element.getBoundingClientRect()),
      target: nameOf(element) || roleOf(element) || 'element',
      described: `${refs.ref(element)} (${describeElement(element)})`,
    };
  }
  const area = input.area as Record<string, unknown> | null;
  const [left, top, width, height] = ['left', 'top', 'width', 'height'].map((key) =>
    typeof area?.[key] === 'number' ? (area[key] as number) : NaN,
  ) as [number, number, number, number];
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return { refusal: 'An area needs a left, top, width and height in viewport pixels, with a positive width and height.' };
  }
  // Only the visible page is in reach: keep the part of the area that is in view.
  const visible = {
    left: Math.max(0, left),
    top: Math.max(0, top),
    right: Math.min(viewport.width, left + width),
    bottom: Math.min(viewport.height, top + height),
  };
  if (visible.right <= visible.left || visible.bottom <= visible.top) {
    return {
      refusal: `That area is outside the visible page (the viewport is ${viewport.width}x${viewport.height}). Only what is in view can be marked.`,
    };
  }
  const clipped = { left: visible.left, top: visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top };
  return {
    anchor: { area: clipped },
    area: clipped,
    described: `the area ${clipped.left},${clipped.top} ${clipped.width}x${clipped.height}`,
  };
}

function viewportOf(doc: Document) {
  const view = doc.defaultView!;
  return { width: view.innerWidth, height: view.innerHeight };
}

const plainRect = (rect: DOMRect): ViewportRect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

const ok = (text: string): PageToolResult => ({ content: [{ type: 'text', text }] });

const refused = (text: string): PageToolResult => ({ content: [{ type: 'text', text }], isError: true });

const unknownElement = (ref: unknown) =>
  `There is no element ${JSON.stringify(ref)} on the page. Call look and use a reference from its list.`;
