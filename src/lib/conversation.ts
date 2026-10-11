import type Anthropic from '@anthropic-ai/sdk';
import { MAX_PAGE_TEXT_CHARS, type PageContext } from './page-context';
import type { ModelId } from './settings';

/**
 * Conversation: owns the Selections and turns of one Conversation, builds each
 * request to the model, consumes the streamed response and emits the events the
 * Panel renders. The model client is passed in.
 */

export type StreamParams = Anthropic.Messages.MessageStreamParams;

/** One item from a streamed model response: a raw stream event, then the final message. */
export type ModelStreamItem =
  | { type: 'event'; event: Anthropic.RawMessageStreamEvent }
  | { type: 'message'; message: Anthropic.Message };

export interface ModelClient {
  /** Streams one response. Aborting `signal` must end the stream. Throws ModelError on failure. */
  stream(params: StreamParams, signal: AbortSignal): AsyncIterable<ModelStreamItem>;
}

export type ModelErrorKind = 'auth' | 'rate_limit' | 'network' | 'web_search' | 'api';

/** A failed model call, classified into the cases the user can act on. */
export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface SelectionInput {
  image: { mediaType: 'image/png' | 'image/jpeg'; data: string };
  /** The page the Selection was made on, captured when it was made. */
  pageContext?: PageContext;
}

export type ConversationEvent =
  /** A Selection was added whose page text was cut off for length. */
  | { type: 'page-text-truncated'; selectionId: number }
  /** A question was sent, carrying the Selections attached to it. */
  | { type: 'turn-started'; question: string; selectionIds: number[] }
  /** More answer text arrived. */
  | { type: 'text'; text: string }
  /** The answer is complete. */
  | { type: 'done' }
  /** The user stopped the answer; the text received so far stands. */
  | { type: 'stopped' };

export interface ConversationOptions {
  client: ModelClient;
  model: ModelId;
  onEvent: (event: ConversationEvent) => void;
}

export const EXPLAIN_QUESTION = 'Explain this.';

export const SYSTEM_PROMPT = `You help a reader who got stuck on part of a web page they are reading or watching. They drag a rectangle over the confusing part; you receive that region as an image (a "Selection"). Each Selection comes with the page's title, URL and text when available (its "Page Context").

- Explain the selected part plainly and briefly: a few short paragraphs at most. The reader can ask for more.
- Use the Page Context to explain the Selection in the context of the whole page, but don't summarize the page.
- If a Selection is unreadable, cut off, or it is unclear what it refers to, say so and suggest selecting again rather than guessing.
- Use Markdown where it helps (short lists, code blocks). Write math in plain text or Unicode, not LaTeX.`;

const MAX_TOKENS = 16000;

/** Stands in for an answer the user stopped before any text arrived. */
const STOPPED_PLACEHOLDER = '(The reader stopped this answer before it began.)';

interface PendingSelection extends SelectionInput {
  id: number;
}

export class Conversation {
  private readonly options: ConversationOptions;
  private readonly history: Anthropic.MessageParam[] = [];
  private pending: PendingSelection[] = [];
  private nextSelectionId = 1;
  private controller: AbortController | null = null;

  constructor(options: ConversationOptions) {
    this.options = options;
  }

  /** Attach a Selection to the next question. Nothing is sent yet. */
  addSelection(selection: SelectionInput): number {
    const id = this.nextSelectionId++;
    this.pending.push({ ...selection, id });
    if (selection.pageContext?.truncated) this.emit({ type: 'page-text-truncated', selectionId: id });
    return id;
  }

  get pendingSelectionIds(): number[] {
    return this.pending.map((s) => s.id);
  }

  /** True while an answer is being generated. */
  get busy(): boolean {
    return this.controller !== null;
  }

  /** Stop the answer being generated, keeping what has arrived. */
  stop() {
    this.controller?.abort();
  }

  explain(): Promise<void> {
    return this.ask(EXPLAIN_QUESTION);
  }

  async ask(question: string): Promise<void> {
    if (this.busy) throw new Error('An answer is already being generated.');
    const selections = this.pending;
    this.pending = [];
    const userMessage: Anthropic.MessageParam = { role: 'user', content: this.userContent(question, selections) };
    this.emit({ type: 'turn-started', question, selectionIds: selections.map((s) => s.id) });

    const controller = new AbortController();
    this.controller = controller;
    let final: Anthropic.Message | undefined;
    let partialText = '';
    try {
      for await (const item of this.options.client.stream(this.buildRequest(userMessage), controller.signal)) {
        if (controller.signal.aborted) break;
        if (item.type === 'message') {
          final = item.message;
          continue;
        }
        const { event } = item;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          partialText += event.delta.text;
          this.emit({ type: 'text', text: event.delta.text });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      this.controller = null;
    }

    if (controller.signal.aborted) {
      // Keep the stopped exchange so follow-ups make sense. Only its text is
      // kept: the partial blocks around it were never completed by the API.
      this.history.push(userMessage, {
        role: 'assistant',
        content: [{ type: 'text', text: partialText.trim() ? partialText : STOPPED_PLACEHOLDER }],
      });
      this.emit({ type: 'stopped' });
      return;
    }
    if (final) this.history.push(userMessage, { role: 'assistant', content: final.content });
    this.emit({ type: 'done' });
  }

  private userContent(question: string, selections: PendingSelection[]): Anthropic.ContentBlockParam[] {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const selection of selections) {
      content.push({ type: 'text', text: describeSelection(selection.id, selection.pageContext) });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: selection.image.mediaType, data: selection.image.data },
      });
    }
    content.push({ type: 'text', text: question });
    return content;
  }

  private buildRequest(userMessage: Anthropic.MessageParam): StreamParams {
    return {
      model: this.options.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [...this.history, userMessage],
      output_config: { effort: 'low' },
      // Automatic caching: the breakpoint follows the end of the conversation, so
      // each follow-up reads earlier Selections and page text from the cache.
      cache_control: { type: 'ephemeral' },
    };
  }

  private emit(event: ConversationEvent) {
    this.options.onEvent(event);
  }
}

function describeSelection(id: number, page: PageContext | undefined): string {
  if (!page) return `Selection ${id}:`;
  const lines = [`Selection ${id}, from this page:`, `Title: ${page.title || '(none)'}`, `URL: ${page.url}`];
  if (page.text) {
    lines.push('<page_text>', page.text, '</page_text>');
    if (page.truncated) {
      lines.push(`(The page text was cut off after ${MAX_PAGE_TEXT_CHARS.toLocaleString('en-US')} characters.)`);
    }
  } else {
    lines.push('(No readable page text.)');
  }
  return lines.join('\n');
}
