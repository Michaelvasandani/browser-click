import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  Conversation,
  EXPLAIN_QUESTION,
  type ConversationEvent,
  type ModelStreamItem,
  type SelectionInput,
} from './conversation';
import type { PageContext } from './page-context';
import { contentOf, FakeModel, response, text } from './testing/fake-model';

const selection = (data = 'aW1hZ2U='): SelectionInput => ({ image: { mediaType: 'image/png', data } });

function setup(options: Partial<ConstructorParameters<typeof Conversation>[0]> = {}) {
  const model = new FakeModel();
  const events: ConversationEvent[] = [];
  const conversation = new Conversation({
    client: model,
    model: 'claude-opus-5-5',
    onEvent: (event) => events.push(event),
    ...options,
  });
  return { model, events, conversation };
}

describe('Conversation: asking about a Selection', () => {
  it('sends nothing until the user asks', async () => {
    const { model, conversation } = setup();
    conversation.addSelection(selection());
    expect(model.requests).toHaveLength(0);
  });

  it('sends the first question with the Selection image and the question', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('It means…')]));
    conversation.addSelection(selection('UE5HREFUQQ=='));
    await conversation.ask('What does this mean?');

    const request = model.lastRequest;
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]?.role).toBe('user');
    const content = contentOf(request, 0);
    expect(content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'UE5HREFUQQ==' },
    });
    // The question comes after the Selection.
    expect(content.at(-1)).toEqual({ type: 'text', text: 'What does this mean?' });
  });

  it('uses the model it was given, low effort and the built-in instruction', async () => {
    const { model, conversation } = setup({ model: 'claude-haiku-5-5' });
    model.respond(response([text('ok')]));
    conversation.addSelection(selection());
    await conversation.ask('Why?');

    const request = model.lastRequest;
    expect(request.model).toBe('claude-haiku-5-5');
    expect(request.output_config).toEqual({ effort: 'low' });
    expect(JSON.stringify(request.system)).toMatch(/plain/i);
    expect(JSON.stringify(request.system)).toMatch(/unreadable|ambiguous/i);
    expect(request.max_tokens).toBeGreaterThan(1000);
  });

  it('"Explain this" sends a default question', async () => {
    const { model, conversation, events } = setup();
    model.respond(response([text('Here is what it says.')]));
    conversation.addSelection(selection());
    await conversation.explain();

    expect(contentOf(model.lastRequest, 0).at(-1)).toEqual({ type: 'text', text: EXPLAIN_QUESTION });
    expect(events).toContainEqual(expect.objectContaining({ type: 'turn-started', question: EXPLAIN_QUESTION }));
  });

  it('streams answer text to the Panel as it arrives, then completes', async () => {
    const { model, conversation, events } = setup();
    model.respond(response([text('Eigenvalues scale vectors.')]));
    const id = conversation.addSelection(selection());
    await conversation.ask('What is this?');

    expect(events[0]).toEqual({ type: 'turn-started', question: 'What is this?', selectionIds: [id] });
    const texts = events.filter((e) => e.type === 'text');
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.map((e) => (e as { text: string }).text).join('')).toBe('Eigenvalues scale vectors.');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('attaches a Selection to one question only', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('first')]));
    conversation.addSelection(selection());
    await conversation.ask('One?');
    expect(conversation.pendingSelectionIds).toEqual([]);
  });
});

describe('Conversation: Page Context', () => {
  const context = (overrides: Partial<PageContext> = {}): PageContext => ({
    title: 'Understanding Eigenvalues',
    url: 'https://example.com/eigen',
    text: 'An eigenvector is a nonzero vector that only gets scaled.',
    truncated: false,
    ...overrides,
  });

  const allText = (blocks: Anthropic.ContentBlockParam[]) =>
    blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n');

  it("sends the Selection's page title, URL and text with it, before the image", async () => {
    const { model, conversation } = setup();
    model.respond(response([text('ok')]));
    conversation.addSelection({ ...selection(), pageContext: context() });
    await conversation.ask('What is this?');

    const content = contentOf(model.lastRequest, 0);
    const sent = allText(content);
    expect(sent).toContain('Understanding Eigenvalues');
    expect(sent).toContain('https://example.com/eigen');
    expect(sent).toContain('An eigenvector is a nonzero vector that only gets scaled.');
    const contextIndex = content.findIndex((b) => b.type === 'text' && b.text.includes('https://example.com/eigen'));
    const imageIndex = content.findIndex((b) => b.type === 'image');
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeLessThan(imageIndex);
  });

  it('tells the model when the page text was cut off', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('ok')]));
    conversation.addSelection({ ...selection(), pageContext: context({ truncated: true }) });
    await conversation.ask('What is this?');
    expect(allText(contentOf(model.lastRequest, 0))).toMatch(/cut off|truncated/i);
  });

  it('surfaces the truncation flag to the Panel when the Selection is added', () => {
    const { conversation, events } = setup();
    const short = conversation.addSelection({ ...selection(), pageContext: context() });
    const long = conversation.addSelection({ ...selection(), pageContext: context({ truncated: true }) });
    expect(events).toContainEqual({ type: 'page-text-truncated', selectionId: long });
    expect(events).not.toContainEqual({ type: 'page-text-truncated', selectionId: short });
  });

  it('still works when a Selection has no Page Context', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('ok')]));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(contentOf(model.lastRequest, 0).some((b) => b.type === 'image')).toBe(true);
  });
});

/** A response that streams `before`, then waits until aborted (or forever). */
function hangingResponse(before: string) {
  return async function* (signal: AbortSignal): AsyncIterable<ModelStreamItem> {
    const [start, ...rest] = response([text(before)]);
    yield start!;
    for (const item of rest) {
      if (item.type === 'event' && item.event.type === 'content_block_stop') break;
      yield item;
    }
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
  };
}

describe('Conversation: stopping an answer', () => {
  it('ends the stream cleanly and keeps the text received so far', async () => {
    const { model, conversation, events } = setup();
    model.respond(hangingResponse('Partial answer'));
    conversation.addSelection(selection());
    const asking = conversation.ask('What is this?');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'text')).toBe(true));
    expect(conversation.busy).toBe(true);

    conversation.stop();
    await asking;

    expect(conversation.busy).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'stopped' });
    expect(events).not.toContainEqual({ type: 'done' });
    const streamed = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
    expect(streamed).toBe('Partial answer');
  });

  it('lets the user ask again in the same Conversation, with the stopped turn in history', async () => {
    const { model, conversation } = setup();
    model.respond(hangingResponse('Partial answer'));
    conversation.addSelection(selection());
    const asking = conversation.ask('First?');
    await vi.waitFor(() => expect(conversation.busy).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    conversation.stop();
    await asking;

    model.respond(response([text('Second answer')]));
    await conversation.ask('Second?');

    const { messages } = model.lastRequest;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(contentOf(model.lastRequest, 0).some((b) => b.type === 'image')).toBe(true);
    expect(contentOf(model.lastRequest, 1)).toEqual([{ type: 'text', text: 'Partial answer' }]);
    expect(contentOf(model.lastRequest, 2).at(-1)).toEqual({ type: 'text', text: 'Second?' });
  });

  it('records a placeholder when stopped before any text arrived', async () => {
    const { model, conversation } = setup();
    model.respond(hangingResponse(''));
    conversation.addSelection(selection());
    const asking = conversation.ask('First?');
    await new Promise((r) => setTimeout(r, 0));
    conversation.stop();
    await asking;

    model.respond(response([text('ok')]));
    await conversation.ask('Again?');
    const stoppedTurn = contentOf(model.lastRequest, 1);
    expect(stoppedTurn).toHaveLength(1);
    expect(stoppedTurn[0]?.type === 'text' && stoppedTurn[0].text.length).toBeGreaterThan(0);
  });

  it('does nothing when no answer is streaming', () => {
    const { conversation, events } = setup();
    conversation.stop();
    expect(events).toEqual([]);
  });
});

describe('Conversation: follow-up questions', () => {
  // An assistant turn as the API returns it, with non-text blocks that must be replayed untouched.
  const richTurn = [
    { type: 'thinking', thinking: '', signature: 'sig-abc123' },
    { type: 'text', text: 'Let me check.', citations: null },
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'eigenvalue' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [
        { type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Eigenvalue', title: 'Eigenvalue', encrypted_content: 'enc-1', page_age: null },
      ],
    },
    {
      type: 'text',
      text: 'It is the scale factor.',
      citations: [
        { type: 'web_search_result_location', url: 'https://en.wikipedia.org/wiki/Eigenvalue', title: 'Eigenvalue', encrypted_index: 'idx-1', cited_text: 'scale factor' },
      ],
    },
  ] as unknown as Anthropic.ContentBlock[];

  it('replays each earlier turn exactly as sent and as the API returned it', async () => {
    const { model, conversation } = setup();
    model.respond(response(richTurn));
    model.respond(response([text('Second answer.')]));
    model.respond(response([text('Third answer.')]));
    conversation.addSelection(selection());
    await conversation.ask('First?');
    await conversation.ask('Second?');
    await conversation.ask('Third?');

    const [first, second, third] = model.requests;
    // The assistant turn is the API's content, block for block.
    expect(second!.messages[1]).toEqual({ role: 'assistant', content: richTurn });
    // Each request's history is the previous request plus its answer: append-only.
    expect(second!.messages.slice(0, 1)).toEqual(first!.messages);
    expect(third!.messages.slice(0, 3)).toEqual(second!.messages);
    expect(third!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(contentOf(third!, 4)).toEqual([{ type: 'text', text: 'Third?' }]);
  });

  it('sends a follow-up without re-sending the Selection', async () => {
    const { model, conversation, events } = setup();
    model.respond(response([text('one')]));
    model.respond(response([text('two')]));
    conversation.addSelection(selection());
    await conversation.ask('First?');
    await conversation.ask('Second?');

    const images = model.lastRequest.messages.flatMap((m) =>
      typeof m.content === 'string' ? [] : m.content.filter((b) => b.type === 'image'),
    );
    expect(images).toHaveLength(1);
    expect(events.filter((e) => e.type === 'turn-started').at(-1)).toEqual({
      type: 'turn-started',
      question: 'Second?',
      selectionIds: [],
    });
  });

  it('asks the API to cache the growing conversation, without changing the prefix between turns', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('one')]));
    model.respond(response([text('two')]));
    conversation.addSelection(selection());
    await conversation.ask('First?');
    await conversation.ask('Second?');

    const [first, second] = model.requests;
    expect(first!.cache_control).toEqual({ type: 'ephemeral' });
    expect(second!.cache_control).toEqual({ type: 'ephemeral' });
    // Everything ahead of the messages is byte-identical, so cached prefixes stay valid.
    const prefix = ({ model, system, tools, output_config }: typeof first & object) => JSON.stringify({ model, system, tools, output_config });
    expect(prefix(second!)).toBe(prefix(first!));
  });
});
