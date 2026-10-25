import type { CaptureResponse } from './messages';
import { MarksLayer } from './marks';

/**
 * Page tools: the one definition of the tools the Assistant may call on the
 * page, shared by every Backend. The definitions (names, descriptions, input
 * schemas) are plain data the Background hands to the native host's MCP
 * server; createPageTools() runs the calls against a document.
 *
 * Every rule about what a tool may touch is enforced here, in page code, never
 * left to the model.
 */

export type PageToolName = 'look' | 'mark' | 'scroll_to';

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
  content: ({ type: 'text'; text: string } | PageToolImage)[];
  isError?: boolean;
}

/** The kinds of Page Action. */
export type PageActionKind = 'scroll';

/**
 * How a Page Action ended: carried out, or refused by the page tools' rules.
 * (Clicks and typing will add 'denied', for a step the user did not allow.)
 */
export type PageActionOutcome = 'done' | 'refused';

/** An image in a page tool result, in MCP's shape. Only look returns one. */
export interface PageToolImage {
  type: 'image';
  /** Base64, without the data URL prefix. */
  data: string;
  mimeType: string;
}

/**
 * Captures the visible tab through the Background, as Selection Mode does.
 * Resolves with a data URL already scaled to fit MAX_IMAGE_DATA_CHARS, or why not.
 */
export type CaptureVisiblePage = () => Promise<CaptureResponse>;

/**
 * The most base64 an image in a look result may carry. The result travels to
 * the native host inside one native message, and Chrome caps those at 1 MB.
 */
export const MAX_IMAGE_DATA_CHARS = 700_000;

/** Something a page tool call did that the Panel shows as a line in the answer. */
export type PageToolEffect =
  | { type: 'mark'; target: string }
  /** `target` names the element as the reader would: its name, or what the Assistant asked for when refused. */
  | { type: 'page-action'; action: PageActionKind; target: string; outcome: PageActionOutcome };

export interface PageToolOutcome {
  result: PageToolResult;
  effect?: PageToolEffect;
}

/** What the Conversation tells the page tools about a call: what the Assistant knows of the page. */
export interface PageToolCallContext {
  /** The Page Context the Assistant has been sent so far (titles and page text). */
  pageText?: string;
}

/** The settings that decide which page tools are offered. */
export interface PageToolSettings {
  drawOnPage: boolean;
  /** Page Actions. Off unless set. */
  actOnPage?: boolean;
}

const LOOK: PageToolDefinition = {
  name: 'look',
  description:
    'List the elements of the page that are currently visible, each with a short reference (such as e3), its role and its name, plus the viewport size. Call it before pointing at anything, and again after the page changes. Set image to also get a picture of the visible page, for content the list cannot describe, such as charts, canvases and video; ask for it only when you need it. The picture may show the browser-click panel, which is not part of the page.',
  inputSchema: {
    type: 'object',
    properties: {
      image: { type: 'boolean', description: 'Also return an image of the visible page. Off by default.' },
    },
    additionalProperties: false,
  },
};

const MARK: PageToolDefinition = {
  name: 'mark',
  description:
    'Draw a box around a visible element of the page, to show the reader where it is. Takes an element reference from the latest look. Changes nothing on the page; the box is cleared when the reader asks the next question.',
  inputSchema: {
    type: 'object',
    properties: { element: { type: 'string', description: 'An element reference from look, such as e3.' } },
    required: ['element'],
    additionalProperties: false,
  },
};

const SCROLL_TO: PageToolDefinition = {
  name: 'scroll_to',
  description:
    'Scroll the page to bring an element into view. Takes either the name of a heading, link, button, field or label exactly as it appears in the Page Context, or an element reference from the latest look. Only goes to things already named in the Page Context, so it cannot be used to search the page. Returns the elements in view afterwards.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The element\'s name, exactly as it appears in the Page Context, such as "Billing".' },
      element: { type: 'string', description: 'Or an element reference from look, such as e3.' },
    },
    additionalProperties: false,
  },
};

/** The page tools the Assistant is given under these settings. */
export function offeredPageTools(settings: PageToolSettings): PageToolDefinition[] {
  const tools: PageToolDefinition[] = [];
  if (settings.drawOnPage || settings.actOnPage) tools.push(LOOK);
  if (settings.drawOnPage) tools.push(MARK);
  if (settings.actOnPage) tools.push(SCROLL_TO);
  return tools;
}

export interface PageTools {
  /** The tools offered under the current settings. A call to any other is refused. */
  readonly offered: readonly PageToolDefinition[];
  /** Runs one call. Never throws: failures and refusals come back as error results. */
  run(call: PageToolCall, context?: PageToolCallContext): Promise<PageToolOutcome>;
  /** Remove the current answer's Marks. Returns true if there were any. */
  clearMarks(): boolean;
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

export interface PageToolsOptions {
  /** How look takes an image of the visible page. Without it, look offers no image. */
  capture?: CaptureVisiblePage;
}

export function createPageTools(doc: Document, settings: PageToolSettings, options: PageToolsOptions = {}): PageTools {
  const offered = offeredPageTools(settings);
  const refs = new Refs();
  let marks: MarksLayer | null = null;

  /**
   * Every Page Action, carried out or refused, returns a short result plus a
   * fresh visible-element list, so the Assistant sees what changed.
   */
  const pageAction = (
    action: PageActionKind,
    target: string,
    outcome: PageActionOutcome,
    summary: string,
  ): PageToolOutcome => {
    const text = `${summary}\n\n${describeVisible(doc, refs)}`;
    return {
      result: outcome === 'done' ? ok(text) : refused(text),
      effect: { type: 'page-action', action, target, outcome },
    };
  };

  /** An image of the visible page, without browser-click's Marks, or why there is none. */
  async function captureImage(): Promise<PageToolImage | string> {
    if (!options.capture) return 'Images of the page are not available here.';
    // A capture now would show Selection Mode's still and shade, not the page.
    if (doc.querySelector('browser-click-overlay')) return 'The reader is making a Selection (Selection Mode is showing).';
    const hidden = marks?.hide();
    let response: CaptureResponse;
    try {
      response = await options.capture();
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (hidden) marks?.show();
    }
    if (!response.ok) return response.error;
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(response.dataUrl);
    if (!match) return 'The capture was not an image.';
    const [, mimeType, data] = match;
    if (data!.length > MAX_IMAGE_DATA_CHARS) return 'The image was too large to send.';
    return { type: 'image', data: data!, mimeType: mimeType! };
  }

  const tools: Record<
    PageToolName,
    (input: Record<string, unknown>, context: PageToolCallContext) => PageToolOutcome | Promise<PageToolOutcome>
  > = {
    look: async (input) => {
      if (input.image !== true) return { result: ok(describeVisible(doc, refs)) };
      const image = await captureImage();
      // Listed after the capture, so the list matches the picture.
      const list = describeVisible(doc, refs);
      if (typeof image === 'string') {
        return { result: refused(`Couldn't take an image of the page: ${image}\nThe element list is below.\n\n${list}`) };
      }
      return { result: { content: [{ type: 'text', text: list }, image] } };
    },
    mark: (input) => {
      const element = refs.element(input.element);
      if (!element) return { result: refused(unknownElement(input.element)) };
      marks ??= new MarksLayer(doc);
      marks.box(element.getBoundingClientRect());
      const target = nameOf(element) || roleOf(element) || 'element';
      return { result: ok(`Marked ${refs.ref(element)} (${describeElement(element)}).`), effect: { type: 'mark', target } };
    },
    scroll_to: (input, context) => {
      const found = scrollTarget(doc, refs, input, context.pageText ?? '');
      if ('refusal' in found) return pageAction('scroll', found.asked, 'refused', found.refusal);
      const { element } = found;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const target = nameOf(element) || roleOf(element);
      return pageAction('scroll', target, 'done', `Scrolled to ${refs.ref(element)} (${describeElement(element)}).`);
    },
  };

  return {
    offered,
    async run(call, context = {}) {
      const tool = offered.find((t) => t.name === call.name);
      if (!tool) return { result: refused(`The ${JSON.stringify(call.name)} tool is not available.`) };
      try {
        const input = call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {};
        return await tools[tool.name](input, context);
      } catch (error) {
        return { result: refused(`The ${tool.name} tool failed: ${error instanceof Error ? error.message : String(error)}`) };
      }
    },
    clearMarks: () => marks?.clear() ?? false,
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

/** Elements scroll_to may go to by name: the listed ones, plus labels that name a part of the page. */
const SCROLL_TARGET_SELECTOR = `${LISTED_SELECTOR}, label, legend`;

const comparable = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The element a scroll_to call asks for, or why it is refused. It goes only to
 * an element the Assistant already knows: one from look, or one whose whole
 * name appears in the Page Context it was sent. So it cannot search the page.
 */
function scrollTarget(
  doc: Document,
  refs: Refs,
  input: Record<string, unknown>,
  pageText: string,
): { element: Element } | { refusal: string; asked: string } {
  if (input.element !== undefined) {
    const asked = String(input.element);
    const element = refs.element(input.element);
    if (!element || !isListed(element)) return { asked, refusal: unknownElement(input.element) };
    return { element };
  }
  if (typeof input.name !== 'string' || !comparable(input.name)) {
    return { asked: 'nothing', refusal: 'Give scroll_to the name of an element from the Page Context, or a reference from look.' };
  }
  const asked = input.name.replace(/\s+/g, ' ').trim();
  const name = comparable(asked);
  if (!comparable(pageText).includes(name)) {
    return {
      asked,
      refusal: `${JSON.stringify(asked)} is not in the Page Context. scroll_to only goes to things the Page Context names; it cannot search the page.`,
    };
  }
  for (const element of doc.querySelectorAll(SCROLL_TARGET_SELECTOR)) {
    if (isListed(element) && comparable(nameOf(element)) === name) return { element };
  }
  return {
    asked,
    refusal: `No element on the page is named exactly ${JSON.stringify(asked)}. Use the name of a heading, link, button, field or label exactly as the Page Context gives it.`,
  };
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

const ok = (text: string): PageToolResult => ({ content: [{ type: 'text', text }] });

const refused = (text: string): PageToolResult => ({ content: [{ type: 'text', text }], isError: true });

const unknownElement = (ref: unknown) =>
  `There is no element ${JSON.stringify(ref)} on the page. Call look and use a reference from its list.`;
