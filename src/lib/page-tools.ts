import type { CaptureResponse } from './messages';
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

export type PageToolName = 'look' | 'mark' | 'scroll_to' | 'click';

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
export type PageActionKind = 'scroll' | 'click';

/**
 * How a Page Action ended: carried out, refused by the page tools' rules, or
 * denied by the user (who did not allow it in the Panel).
 */
export type PageActionOutcome = 'done' | 'refused' | 'denied';

/**
 * A Page Action waiting for the user's Allow, as the Panel shows it. The page
 * tools ask only after their own rules let the step through.
 */
export interface ApprovalRequest {
  action: 'click';
  /** The element's name, as the reader would say it (or its role, if it has no name). */
  target: string;
  role: string;
}

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
  | MarkEffect
  /** `target` names the element as the reader would: its name, or what the Assistant asked for when refused. */
  | { type: 'page-action'; action: PageActionKind; target: string; outcome: PageActionOutcome };

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

/** What the Conversation tells the page tools about a call: what the Assistant knows of the page. */
export interface PageToolCallContext {
  /** The Page Context the Assistant has been sent so far (titles and page text). */
  pageText?: string;
  /**
   * Asks the user to allow a click or typing. Resolves true only on Allow.
   * Without it, every such step is denied.
   */
  approve?: (request: ApprovalRequest) => Promise<boolean>;
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

const CLICK: PageToolDefinition = {
  name: 'click',
  description:
    'Click a button or link in view, when that is the obvious next step for what the reader asked. Takes an element reference from the latest look; never coordinates. Each click waits for the reader to allow it, and they may say no: if so, carry on without it. Some clicks are always refused: anything that submits a form, links that leave the page, and content embedded from other sites. Returns the elements in view afterwards.',
  inputSchema: {
    type: 'object',
    properties: { element: { type: 'string', description: 'An element reference from look, such as e3.' } },
    required: ['element'],
    additionalProperties: false,
  },
};

/** How long a click is given to change the page before the elements in view are listed. */
const CLICK_SETTLE_MS = 150;

/** The page tools the Assistant is given under these settings. */
export function offeredPageTools(settings: PageToolSettings): PageToolDefinition[] {
  const tools: PageToolDefinition[] = [];
  if (settings.drawOnPage || settings.actOnPage) tools.push(LOOK);
  if (settings.drawOnPage) tools.push(MARK);
  if (settings.actOnPage) tools.push(SCROLL_TO, CLICK);
  return tools;
}

export interface PageTools {
  /** The tools offered under the current settings. A call to any other is refused. */
  readonly offered: readonly PageToolDefinition[];
  /** Runs one call. Never throws: failures and refusals come back as error results. */
  run(call: PageToolCall, context?: PageToolCallContext): Promise<PageToolOutcome>;
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

export interface PageToolsOptions {
  /** How look takes an image of the visible page. Without it, look offers no image. */
  capture?: CaptureVisiblePage;
}

export function createPageTools(doc: Document, settings: PageToolSettings, options: PageToolsOptions = {}): PageTools {
  const offered = offeredPageTools(settings);
  const refs = new Refs();
  let marks: MarksLayer | null = null;
  // The highest label number in the current answer's Marks, so labels count on by default.
  let labelsDrawn = 0;
  // Marks are hidden during Selection Mode.
  let hiddenForSelection = false;

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
      if (hiddenForSelection) marks.setHidden(true);
      marks.draw(kind as MarkKind, where.anchor, number);
      if (kind === 'label') labelsDrawn = Math.max(labelsDrawn, number!);
      const effect: MarkEffect = { type: 'mark', kind: kind as MarkKind, area: where.area };
      if (where.target !== undefined) effect.target = where.target;
      if (number !== undefined) effect.number = number;
      const what = kind === 'label' ? `label ${number}` : String(kind);
      return { result: ok(`Drew a ${what} at ${where.described}.`), effect };
    },
    scroll_to: (input, context) => {
      const found = scrollTarget(doc, refs, input, context.pageText ?? '');
      if ('refusal' in found) return pageAction('scroll', found.asked, 'refused', found.refusal);
      const { element } = found;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const target = nameOf(element) || roleOf(element);
      return pageAction('scroll', target, 'done', `Scrolled to ${refs.ref(element)} (${describeElement(element)}).`);
    },
    click: async (input, context) => {
      const found = clickTarget(doc, refs, input);
      if ('refusal' in found) return pageAction('click', found.asked, 'refused', found.refusal);
      const { element } = found;
      const target = nameOf(element) || roleOf(element);
      const described = `${refs.ref(element)} (${describeElement(element)})`;
      const allowed = (await context.approve?.({ action: 'click', target, role: roleOf(element) })) ?? false;
      if (!allowed) {
        return pageAction('click', target, 'denied', `The user didn't allow this: ${described} was not clicked. Carry on without it.`);
      }
      // The page may have changed while the user decided.
      if (!element.isConnected) return pageAction('click', target, 'refused', `${described} is no longer on the page.`);
      const still = clickTarget(doc, refs, { element: refs.ref(element) });
      if ('refusal' in still) return pageAction('click', target, 'refused', `It changed while the user decided: ${still.refusal}`);
      const stopped = await whileActing(doc, async () => {
        (element as HTMLElement).click();
        await new Promise((resolve) => setTimeout(resolve, CLICK_SETTLE_MS));
      });
      if (stopped) return pageAction('click', target, 'refused', `Clicked ${described}, but ${stopped}`);
      return pageAction('click', target, 'done', `Clicked ${described}.`);
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
    clearMarks() {
      labelsDrawn = 0;
      return marks?.clear() ?? false;
    },
    setMarksHidden(hide) {
      hiddenForSelection = hide;
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

/**
 * The element a click call asks for, or why it is refused: one the Assistant
 * looked up, still listed and in view. The rules run before the user is asked.
 */
function clickTarget(doc: Document, refs: Refs, input: Record<string, unknown>): { element: Element } | { refusal: string; asked: string } {
  const asked = typeof input.element === 'string' ? input.element : 'nothing';
  const element = refs.element(input.element);
  if (!element) return { asked, refusal: unknownElement(input.element) };
  const outOfReach = offLimits(doc, element);
  if (outOfReach) return { asked: nameOf(element) || roleOf(element), refusal: `${refs.ref(element)} ${outOfReach}` };
  if (!isListed(element)) return { asked, refusal: unknownElement(input.element) };
  const view = doc.defaultView!;
  if (!inView(element, { width: view.innerWidth, height: view.innerHeight })) {
    return { asked, refusal: `${refs.ref(element)} (${describeElement(element)}) is not in view. Only what is in view can be clicked.` };
  }
  const never = neverClicked(element);
  if (never) {
    return { asked: nameOf(element) || roleOf(element), refusal: `${refs.ref(element)} (${describeElement(element)}) ${never}` };
  }
  return { element };
}

/**
 * Why no Page Action may ever touch this element, or undefined if the
 * action's own rules decide. Out of reach: browser-click's own elements (the
 * Panel, Selection Mode, Marks), anything outside this document (shadow roots
 * included), and frames holding content from another origin.
 */
function offLimits(doc: Document, element: Element): string | undefined {
  if (element.ownerDocument !== doc) return 'is in content embedded from another site. browser-click never acts inside it.';
  for (let node: Element | null = element; node; ) {
    if (node.tagName.startsWith(OWN_ELEMENT_PREFIX)) {
      return "is part of browser-click's own panel or Marks, not the page. browser-click never acts on its own controls.";
    }
    // Climb out of shadow roots too: the Panel's controls live in one.
    node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host || null);
  }
  if (isFrame(element) && !sameOriginFrame(element as HTMLIFrameElement)) {
    return 'is content embedded from another site. browser-click never acts inside it; tell the reader what to do there instead.';
  }
  return undefined;
}

const isFrame = (element: Element) => ['IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(element.tagName);

/** Whether a frame shows content from the page's own origin. A sandbox without allow-same-origin never does. */
function sameOriginFrame(frame: HTMLIFrameElement): boolean {
  const sandbox = frame.getAttribute('sandbox');
  if (sandbox !== null && !sandbox.toLowerCase().split(/\s+/).includes('allow-same-origin')) return false;
  if (frame.tagName !== 'IFRAME' && frame.tagName !== 'FRAME') return false;
  if (frame.hasAttribute('srcdoc')) return true;
  const src = frame.getAttribute('src')?.trim();
  if (!src || src === 'about:blank') return true;
  try {
    return new URL(src, frame.ownerDocument.baseURI).origin === new URL(frame.ownerDocument.URL).origin;
  } catch {
    return false;
  }
}

/**
 * Runs a Page Action with the page kept in place: a link click or form
 * submission the page's own scripts did not handle is cancelled, and anything
 * that still tries to unload the page (a script we couldn't predict) makes
 * the browser ask "Leave site?". Resolves with what was stopped, if anything.
 */
async function whileActing(doc: Document, act: () => Promise<void>): Promise<string | undefined> {
  const view = doc.defaultView!;
  let stopped: string | undefined;
  // Bubble phase on the window: after the page's own handlers, such as a router's.
  const onClick = (event: Event) => {
    if (event.defaultPrevented || !(event.target instanceof view.Element)) return;
    const activated = activatedBy(event.target);
    if (!activated?.matches('a[href], area[href]') || staysInDocument(activated as HTMLAnchorElement)) return;
    event.preventDefault();
    stopped = 'it would have loaded another page, so browser-click stopped it. The page did not change. Tell the reader where the link goes instead.';
  };
  // Capture phase on the window, before the page's handlers: many pages send a
  // form from their own submit handler, so they must not see the event at all.
  const onSubmit = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    stopped = 'the page tried to submit a form, so browser-click stopped it. Nothing was sent.';
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Older browsers ask only when returnValue is set.
    event.returnValue = '';
  };
  view.addEventListener('click', onClick);
  view.addEventListener('submit', onSubmit, true);
  view.addEventListener('beforeunload', onBeforeUnload);
  try {
    await act();
  } finally {
    view.removeEventListener('click', onClick);
    view.removeEventListener('submit', onSubmit, true);
    view.removeEventListener('beforeunload', onBeforeUnload);
  }
  return stopped;
}

/** Whether following this link stays in the current document: an in-page link, or a script link. */
function staysInDocument(link: HTMLAnchorElement | HTMLAreaElement): boolean {
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return false;
  }
  if (url.protocol === 'javascript:') return true;
  const here = new URL(link.ownerDocument.URL);
  return url.hash !== '' && url.origin === here.origin && url.pathname === here.pathname && url.search === here.search;
}

/**
 * What a click on this element would activate: the nearest link, button or
 * field it is inside (a click on a span in a button presses the button), or
 * the control a label is for.
 */
function activatedBy(element: Element): Element | null {
  const activatable = element.closest('a[href], area[href], button, input, select, textarea, label');
  if (activatable?.tagName === 'LABEL') return (activatable as HTMLLabelElement).control ?? null;
  return activatable;
}

/** Why a click on this element is never allowed, Allow or not; or undefined if it may be asked for. */
function neverClicked(element: Element): string | undefined {
  const activated = activatedBy(element);
  if (activated && submitsForm(activated)) {
    return 'would submit a form. browser-click never submits forms; tell the reader what to press instead.';
  }
  if (activated?.matches('a[href], area[href]')) return leavesPage(activated as HTMLAnchorElement | HTMLAreaElement);
  return undefined;
}

/**
 * Why following this link would leave the page, or undefined if it may stay
 * on it. In-page (#fragment) links stay. Other links to this site are allowed
 * through, since a single-page app's router may handle them without loading a
 * document; the click is then guarded by `guardNavigation`.
 */
function leavesPage(link: HTMLAnchorElement | HTMLAreaElement): string | undefined {
  const doc = link.ownerDocument;
  const tell = 'Tell the reader where the link goes instead.';
  if (link.hasAttribute('download')) return `would download a file. browser-click never follows download links. ${tell}`;
  const target = (link.getAttribute('target') ?? doc.querySelector('base[target]')?.getAttribute('target') ?? '').trim().toLowerCase();
  if (target && target !== '_self') return `would open a new tab or window. browser-click never opens other pages. ${tell}`;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return `has a link browser-click can't read. ${tell}`;
  }
  if (url.protocol === 'javascript:') return undefined;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `would open another app (${url.protocol}). ${tell}`;
  if (url.origin !== new URL(doc.URL).origin) return `would leave the page for another site (${url.host}). ${tell}`;
  return undefined;
}

/** Whether pressing this control submits a form: any submit control, or a default button inside a form. */
function submitsForm(control: Element): boolean {
  const tag = control.tagName;
  if (tag === 'INPUT') return ['submit', 'image'].includes((control as HTMLInputElement).type);
  if (tag !== 'BUTTON') return false;
  const button = control as HTMLButtonElement;
  if (button.type !== 'submit') return false;
  // A button with no type is a submit button only inside a form.
  return button.getAttribute('type')?.trim().toLowerCase() === 'submit' || button.form !== null;
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
