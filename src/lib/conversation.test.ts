import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  Conversation,
  EXPLAIN_QUESTION,
  ModelError,
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

describe('Conversation: adding a Selection', () => {
  const page = (url: string, body: string): PageContext => ({ title: `Title of ${url}`, url, text: body, truncated: false });

  async function afterFirstAnswer() {
    const harness = setup();
    harness.model.respond(response([text('first answer')]));
    harness.conversation.addSelection({ ...selection('Zmlyc3Q='), pageContext: page('https://a.test/1', 'Text of page one.') });
    await harness.conversation.ask('First?');
    return harness;
  }

  it('sends an added Selection with the next question, not on its own', async () => {
    const { model, conversation } = await afterFirstAnswer();
    const id = conversation.addSelection({ ...selection('c2Vjb25k'), pageContext: page('https://a.test/1', 'Text of page one.') });
    expect(model.requests).toHaveLength(1);
    expect(conversation.pendingSelectionIds).toEqual([id]);

    model.respond(response([text('second answer')]));
    await conversation.ask('How does this relate to the first?');
    const content = contentOf(model.lastRequest, 2);
    expect(content).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'c2Vjb25k' } });
    expect(content.at(-1)).toEqual({ type: 'text', text: 'How does this relate to the first?' });
    expect(conversation.pendingSelectionIds).toEqual([]);
  });

  it('carries the Page Context captured when the added Selection was made', async () => {
    const { model, conversation } = await afterFirstAnswer();
    // e.g. YouTube moved to the next video without reloading
    conversation.addSelection({ ...selection(), pageContext: page('https://a.test/2', 'Text of page two.') });
    model.respond(response([text('ok')]));
    await conversation.ask('And this?');

    const sent = contentOf(model.lastRequest, 2)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n');
    expect(sent).toContain('https://a.test/2');
    expect(sent).toContain('Title of https://a.test/2');
    expect(sent).toContain('Text of page two.');
    expect(sent).not.toContain('Text of page one.');
  });

  it('does not repeat page text already sent for an earlier Selection from the same page', async () => {
    const { model, conversation } = await afterFirstAnswer();
    conversation.addSelection({ ...selection(), pageContext: page('https://a.test/1', 'Text of page one.') });
    model.respond(response([text('ok')]));
    await conversation.ask('And this?');

    const sent = contentOf(model.lastRequest, 2)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n');
    expect(sent).toContain('https://a.test/1');
    expect(sent).toMatch(/same page as Selection 1/i);
    expect(sent).not.toContain('Text of page one.');
  });

  it('sends several added Selections together, each with its own Page Context', async () => {
    const { model, conversation, events } = await afterFirstAnswer();
    const a = conversation.addSelection({ ...selection('YQ=='), pageContext: page('https://a.test/2', 'Two.') });
    const b = conversation.addSelection({ ...selection('Yg=='), pageContext: page('https://a.test/3', 'Three.') });
    model.respond(response([text('ok')]));
    await conversation.ask('Compare these.');

    const content = contentOf(model.lastRequest, 2);
    expect(content.filter((block) => block.type === 'image')).toHaveLength(2);
    const sent = content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
    expect(sent).toContain('Two.');
    expect(sent).toContain('Three.');
    expect(events).toContainEqual({ type: 'turn-started', question: 'Compare these.', selectionIds: [a, b] });
  });
});

describe('Conversation: web search', () => {
  const searchTurn = (stopReason: Anthropic.StopReason = 'end_turn') =>
    response(
      [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'spectral theorem' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [
            { type: 'web_search_result', url: 'https://a.test/x', title: 'Result X', encrypted_content: 'e1', page_age: null },
            { type: 'web_search_result', url: 'https://b.test/y', title: 'Result Y', encrypted_content: 'e2', page_age: null },
          ],
        },
        {
          type: 'text',
          text: 'The spectral theorem says…',
          citations: [
            { type: 'web_search_result_location', url: 'https://b.test/y', title: 'Result Y', encrypted_index: 'i', cited_text: '…' },
            { type: 'web_search_result_location', url: 'https://b.test/y', title: 'Result Y', encrypted_index: 'j', cited_text: '…' },
          ],
        },
      ] as unknown as Anthropic.ContentBlock[],
      { stopReason },
    );

  it('offers the web search tool, limited to 3 searches, when enabled', async () => {
    const { model, conversation } = setup({ webSearch: true, model: 'claude-sonnet-5-5' });
    model.respond(response([text('ok')]));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(model.lastRequest.tools).toEqual([{ type: 'web_search_20260318', name: 'web_search', max_uses: 3 }]);
  });

  it('sends the same, newest tool version whichever model is chosen', async () => {
    const { model, conversation } = setup({ webSearch: true, model: 'claude-haiku-5-5' });
    model.respond(response([text('ok')]));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(model.lastRequest.tools).toEqual([{ type: 'web_search_20260318', name: 'web_search', max_uses: 3 }]);
  });

  it('omits the tool entirely when web search is off', async () => {
    const { model, conversation } = setup({ webSearch: false });
    model.respond(response([text('ok')]));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(model.lastRequest).not.toHaveProperty('tools');
  });

  it('tells the Panel while a search is running', async () => {
    const { model, conversation, events } = setup({ webSearch: true });
    model.respond(searchTurn());
    conversation.addSelection(selection());
    await conversation.ask('What is this?');

    const start = events.findIndex((e) => e.type === 'searching' && e.active);
    const end = events.findIndex((e) => e.type === 'searching' && !e.active);
    const firstText = events.findIndex((e) => e.type === 'text');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(firstText);
  });

  it('lists the cited sources under the answer, once each', async () => {
    const { model, conversation, events } = setup({ webSearch: true });
    model.respond(searchTurn());
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(events).toContainEqual({ type: 'sources', sources: [{ url: 'https://b.test/y', title: 'Result Y' }] });
    expect(events.findIndex((e) => e.type === 'sources')).toBeLessThan(events.findIndex((e) => e.type === 'done'));
  });

  it('falls back to the search results when the answer cites nothing', async () => {
    const { model, conversation, events } = setup({ webSearch: true });
    model.respond(
      response([
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [{ type: 'web_search_result', url: 'https://a.test/x', title: 'Result X', encrypted_content: 'e', page_age: null }],
        },
        text('Answer without citations.'),
      ] as unknown as Anthropic.ContentBlock[]),
    );
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(events).toContainEqual({ type: 'sources', sources: [{ url: 'https://a.test/x', title: 'Result X' }] });
  });

  it('sends no sources event when nothing was searched', async () => {
    const { model, conversation, events } = setup({ webSearch: true });
    model.respond(response([text('From memory.')]));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(events.some((e) => e.type === 'sources' || e.type === 'searching')).toBe(false);
  });

  it('resumes a paused search turn without adding a user message', async () => {
    const { model, conversation, events } = setup({ webSearch: true });
    const paused = [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } },
    ] as unknown as Anthropic.ContentBlock[];
    model.respond(response(paused, { stopReason: 'pause_turn' }));
    model.respond(response([text('Resumed answer.')]));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');

    expect(model.requests).toHaveLength(2);
    const resumed = model.requests[1]!;
    expect(resumed.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(resumed.messages[1]).toEqual({ role: 'assistant', content: paused });
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);

    model.respond(response([text('ok')]));
    await conversation.ask('Next?');
    expect(model.lastRequest.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant', 'user']);
  });
});

describe('Conversation: errors and refusals', () => {
  it.each([
    ['auth', /API key/],
    ['rate_limit', /rate limit/i],
    ['network', /connection|reach/i],
  ] as const)('reports a %s error in plain words and offers a retry', async (kind, wording) => {
    const { model, conversation, events } = setup();
    model.respond(new ModelError(kind, 'raw API message'));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');

    const error = events.at(-1);
    expect(error).toMatchObject({ type: 'error', kind, retryable: true });
    expect(error?.type === 'error' && error.message).toMatch(wording);
    expect(conversation.busy).toBe(false);
  });

  it("shows any other API error with the API's own message", async () => {
    const { model, conversation, events } = setup();
    model.respond(new ModelError('api', 'Overloaded'));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(events.at(-1)).toEqual({ type: 'error', kind: 'api', message: 'Overloaded', retryable: true });
  });

  it('retries by re-sending the same question with the same Selections', async () => {
    const { model, conversation, events } = setup();
    model.respond(new ModelError('network', 'offline'));
    model.respond(response([text('Recovered.')]));
    const id = conversation.addSelection(selection('aW1n'));
    await conversation.ask('What is this?');
    const failed = model.lastRequest;

    await conversation.retry();
    expect(model.requests).toHaveLength(2);
    expect(model.lastRequest).toEqual(failed);
    expect(events.filter((e) => e.type === 'turn-started').at(-1)).toEqual({
      type: 'turn-started',
      question: 'What is this?',
      selectionIds: [id],
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('keeps the Conversation usable: a different question after an error carries the unsent Selections', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('First answer.')]));
    model.respond(new ModelError('rate_limit', 'slow down'));
    model.respond(response([text('ok')]));
    conversation.addSelection(selection('Zmlyc3Q='));
    await conversation.ask('First?');
    const second = conversation.addSelection(selection('c2Vjb25k'));
    await conversation.ask('Second?');
    expect(conversation.pendingSelectionIds).toEqual([second]);

    await conversation.ask('Something else?');
    const { messages } = model.lastRequest;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(contentOf(model.lastRequest, 2)).toContainEqual(
      expect.objectContaining({ type: 'image', source: expect.objectContaining({ data: 'c2Vjb25k' }) }),
    );
    expect(contentOf(model.lastRequest, 2).at(-1)).toEqual({ type: 'text', text: 'Something else?' });
  });

  it('says plainly when the Assistant declines, without retrying on another model', async () => {
    const { model, conversation, events } = setup();
    model.respond(response([text('')], { stopReason: 'refusal' }));
    conversation.addSelection(selection());
    await conversation.ask('Something it declines?');

    expect(model.requests).toHaveLength(1);
    expect(model.lastRequest).not.toHaveProperty('fallbacks');
    const refusal = events.at(-1);
    expect(refusal).toMatchObject({ type: 'refusal' });
    expect(refusal?.type === 'refusal' && refusal.message).toMatch(/declined/i);
    expect(events).not.toContainEqual({ type: 'done' });
  });

  it('leaves the Conversation usable after a refusal, with the refused exchange left out', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('First answer.')]));
    model.respond(response([text('I can’t')], { stopReason: 'refusal' }));
    model.respond(response([text('Sure.')]));
    model.respond(response([text('Again.')]));
    conversation.addSelection(selection());
    await conversation.ask('First?');
    await conversation.ask('Declined?');

    await conversation.retry();
    expect(model.lastRequest.model).toBe('claude-opus-5-5');
    expect(contentOf(model.lastRequest, 2).at(-1)).toEqual({ type: 'text', text: 'Declined?' });

    await conversation.ask('Next?');
    expect(model.lastRequest.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  });

  it('has nothing to retry after a successful answer', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('ok')]));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');
    expect(conversation.canRetry).toBe(false);
    await conversation.retry();
    expect(model.requests).toHaveLength(1);
  });
});

describe('Conversation: unexpected failures', () => {
  it('treats an unexpected failure like an API error: reported, retryable, Selections kept', async () => {
    const { model, conversation, events } = setup();
    model.respond(new Error('Extension context invalidated.'));
    model.respond(response([text('ok')]));
    const id = conversation.addSelection(selection());
    await conversation.ask('What is this?');

    expect(events.at(-1)).toEqual({
      type: 'error',
      kind: 'api',
      message: 'Extension context invalidated.',
      retryable: true,
    });
    expect(conversation.pendingSelectionIds).toEqual([id]);
    expect(conversation.canRetry).toBe(true);
    await conversation.retry();
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('does not commit a turn that is still paused after the last allowed continuation', async () => {
    const { model, conversation, events } = setup({ webSearch: true });
    const paused = [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } },
    ] as unknown as Anthropic.ContentBlock[];
    for (let i = 0; i < 4; i++) model.respond(response(paused, { stopReason: 'pause_turn' }));
    conversation.addSelection(selection());
    await conversation.ask('What is this?');

    expect(model.requests).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'api', retryable: true });
    expect(events).not.toContainEqual({ type: 'done' });
    expect(conversation.canRetry).toBe(true);

    model.respond(response([text('ok')]));
    await conversation.ask('Something else?');
    expect(model.lastRequest.messages.map((m) => m.role)).toEqual(['user']);
  });
});
