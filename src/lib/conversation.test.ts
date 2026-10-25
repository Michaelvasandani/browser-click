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
import type { CaptureResponse } from './messages';
import { createPageTools, offeredPageTools, type CaptureVisiblePage } from './page-tools';
import {
  contentOf,
  FakeModel,
  pageToolCall,
  refOf,
  response,
  resultText,
  text,
  type ScriptedPageToolCall,
} from './testing/fake-model';
import { marksOn, marksShowing, pageDocument, scrollWindow } from './testing/page-document';

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

describe('Conversation: Marks', () => {
  const SETTINGS_PAGE = `
    <h1>Settings</h1>
    <label data-rect="40,100,200,16"><input type="checkbox" role="switch" data-rect="40,100,30,16"> Notifications</label>
    <button data-rect="40,200,80,30">Save</button>`;

  /** Looks the page up, then marks the element with this name, then answers. */
  function lookThenMark(name: string, answer = 'It is here.') {
    const look = pageToolCall('look');
    let mark: ScriptedPageToolCall | undefined;
    const script = async function* () {
      yield look;
      mark = pageToolCall('mark', { element: refOf(await look.result, name) });
      yield mark;
      yield* response([text(answer)]);
    };
    return { script, look, mark: () => mark! };
  }

  function setupOnPage(body: string, { drawOnPage = true } = {}) {
    const doc = pageDocument(body);
    const pageTools = createPageTools(doc, { drawOnPage });
    return { doc, pageTools, ...setup({ pageTools }) };
  }

  it('draws a box around the element the Assistant looked up, and tells the Panel', async () => {
    const { doc, model, events, conversation } = setupOnPage(SETTINGS_PAGE);
    const before = doc.body.innerHTML;
    const { script, look, mark } = lookThenMark('Notifications');
    model.respond(script);
    await conversation.ask("Where's the notifications toggle?");

    const seen = resultText(await look.result);
    expect(seen).toMatch(/viewport: 1024x768/i);
    expect(seen).toMatch(/switch "Notifications"/);
    expect(seen).toMatch(/button "Save"/);
    expect((await mark().result).isError).toBeFalsy();

    expect(events).toContainEqual(expect.objectContaining({ type: 'mark', kind: 'box', target: 'Notifications' }));
    expect(events.at(-1)).toEqual({ type: 'done' });
    const [box, ...others] = marksOn(doc);
    expect(others).toEqual([]);
    // Around the toggle, in its own layer that lets clicks through to the page.
    expect(box!.left).toBeLessThanOrEqual(40);
    expect(box!.top).toBeLessThanOrEqual(100);
    expect(box!.left + box!.width).toBeGreaterThanOrEqual(70);
    expect(box!.top + box!.height).toBeGreaterThanOrEqual(116);
    expect(box!.pointerEvents).toBe('none');
    // The page itself is unchanged.
    expect(doc.body.innerHTML).toBe(before);
  });

  it("leaves the Panel and browser-click's other elements out of what the Assistant sees", async () => {
    const { doc, model, conversation } = setupOnPage(SETTINGS_PAGE);
    const panel = doc.createElement('browser-click-panel');
    panel.innerHTML = '<button>Allow</button>';
    panel.attachShadow({ mode: 'closed' }).innerHTML = '<button>Deny</button>';
    doc.documentElement.append(panel);
    const overlay = doc.createElement('browser-click-overlay');
    overlay.innerHTML = '<div role="dialog" aria-label="Select an area">Drag</div>';
    doc.body.append(overlay);

    // A Mark first, so the Marks layer is on the page too.
    const { script, look } = lookThenMark('Notifications');
    model.respond(script);
    await conversation.ask('Where is it?');
    const secondLook = pageToolCall('look');
    model.respond([secondLook, ...response([text('ok')])]);
    await conversation.ask('What else is here?');

    for (const seen of [resultText(await look.result), resultText(await secondLook.result)]) {
      expect(seen).toMatch(/Notifications/);
      expect(seen).not.toMatch(/Allow|Deny|Select an area|browser-click/i);
    }
  });

  it("clears an answer's Marks when the next question is sent", async () => {
    const { doc, model, events, conversation } = setupOnPage(SETTINGS_PAGE);
    model.respond(lookThenMark('Notifications').script);
    await conversation.ask('Where is it?');
    expect(marksOn(doc)).toHaveLength(1);

    let marksWhenSent = -1;
    model.respond(async function* () {
      marksWhenSent = marksOn(doc).length;
      yield* response([text('Anything else?')]);
    });
    await conversation.ask('Thanks. And then?');

    expect(marksWhenSent).toBe(0);
    expect(marksOn(doc)).toEqual([]);
    const secondTurn = events.slice(events.findLastIndex((e) => e.type === 'turn-started'));
    expect(secondTurn).toContainEqual({ type: 'marks-cleared' });
  });

  it('tells the Assistant it can draw Marks when drawing on the page is on', async () => {
    const { model, conversation } = setupOnPage(SETTINGS_PAGE);
    model.respond(response([text('ok')]));
    await conversation.ask('Where is it?');
    expect(String(model.lastRequest.system)).toMatch(/\bmarks?\b/i);
  });

  it('offers no page tools when drawing on the page is off, and refuses a call to one anyway', async () => {
    const { doc, pageTools, model, events, conversation } = setupOnPage(SETTINGS_PAGE, { drawOnPage: false });
    expect(pageTools.offered).toEqual([]);
    const look = pageToolCall('look');
    const mark = pageToolCall('mark', { element: 'e1' });
    model.respond([look, mark, ...response([text('ok')])]);
    await conversation.ask('Where is it?');

    expect(String(model.lastRequest.system)).not.toMatch(/\bmarks?\b|\blook\b/i);
    expect(await look.result).toMatchObject({ isError: true });
    expect(await mark.result).toMatchObject({ isError: true });
    expect(marksOn(doc)).toEqual([]);
    expect(events.some((e) => e.type === 'mark')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('tells the Assistant nothing about Marks without page tools, as on the API key backend', async () => {
    const { model, conversation } = setup();
    model.respond(response([text('ok')]));
    await conversation.ask('Where is it?');
    expect(String(model.lastRequest.system)).not.toMatch(/\bmarks?\b/i);
  });

  it('lists only what is in view and not hidden', async () => {
    const { model, conversation } = setupOnPage(`
      <button data-rect="10,10,80,20">In view</button>
      <button data-rect="10,2000,80,20">Below the fold</button>
      <button data-rect="0,0,0,0">No size</button>
      <button hidden>Hidden</button>
      <div style="display: none"><a href="/x">Inside hidden</a></div>`);
    const look = pageToolCall('look');
    model.respond([look, ...response([text('ok')])]);
    await conversation.ask('What is here?');

    const seen = resultText(await look.result);
    expect(seen).toMatch(/button "In view"/);
    expect(seen).not.toMatch(/Below the fold|No size|Hidden/);
  });

  it('refuses a Mark at an element the Assistant never looked up', async () => {
    const { doc, model, events, conversation } = setupOnPage(SETTINGS_PAGE);
    const mark = pageToolCall('mark', { element: 'e99' });
    model.respond([mark, ...response([text('ok')])]);
    await conversation.ask('Where is it?');

    expect(await mark.result).toMatchObject({ isError: true });
    expect(resultText(await mark.result)).toMatch(/look/);
    expect(marksOn(doc)).toEqual([]);
    expect(events.some((e) => e.type === 'mark')).toBe(false);
  });
});

describe('Conversation: Mark kinds and Marks on a live page', () => {
  const PAGE = `
    <h1 data-rect="40,20,300,30">Settings</h1>
    <button data-rect="400,200,80,30">Save</button>
    <iframe src="https://video.example/embed/1" title="Product video" data-rect="40,300,480,270"></iframe>`;

  function setupOnPage(body = PAGE) {
    const doc = pageDocument(body);
    const pageTools = createPageTools(doc, { drawOnPage: true });
    return { doc, pageTools, ...setup({ pageTools }) };
  }

  /** Looks the page up, then draws one Mark per input (at the element `name` names, if any), then answers. */
  function lookThenMarks(...marks: Record<string, unknown>[]) {
    const look = pageToolCall('look');
    const calls: ScriptedPageToolCall[] = [];
    const script = async function* () {
      yield look;
      const seen = await look.result;
      for (const { name, ...input } of marks) {
        const call = pageToolCall('mark', name ? { ...input, element: refOf(seen, String(name)) } : input);
        calls.push(call);
        yield call;
      }
      yield* response([text('There.')]);
    };
    return { script, look, calls };
  }

  const SAVE = { left: 400, top: 200, width: 80, height: 30 };

  it('draws a box, an arrow, a highlight and a numbered label, and tells the Panel which', async () => {
    const { doc, model, events, conversation } = setupOnPage();
    const { script, calls } = lookThenMarks(
      { name: 'Save', kind: 'box' },
      { name: 'Save', kind: 'arrow' },
      { name: 'Settings', kind: 'highlight' },
      { name: 'Save', kind: 'label', number: 2 },
    );
    model.respond(script);
    await conversation.ask('How do I save?');

    for (const call of calls) expect((await call.result).isError).toBeFalsy();
    const marks = marksOn(doc);
    expect(marks.map((m) => m.kind)).toEqual(['box', 'arrow', 'highlight', 'label']);
    const [box, arrow, highlight, label] = marks;
    // The box surrounds Save.
    expect(box!.left).toBeLessThanOrEqual(400);
    expect(box!.left + box!.width).toBeGreaterThanOrEqual(480);
    // The arrow sits beside Save, ending at its edge, without covering it.
    expect(arrow!.left + arrow!.width).toBeLessThanOrEqual(400);
    expect(arrow!.left + arrow!.width).toBeGreaterThan(390);
    expect(arrow!.top).toBeLessThan(215);
    expect(arrow!.top + arrow!.height).toBeGreaterThan(215);
    // The highlight covers the heading exactly.
    expect(highlight).toMatchObject({ left: 40, top: 20, width: 300, height: 30 });
    // The label shows its number on Save's top-left corner.
    expect(label!.text).toBe('2');
    expect(label!.left).toBeLessThan(400);
    expect(label!.left + label!.width).toBeGreaterThan(400);

    expect(events.filter((e) => e.type === 'mark')).toEqual([
      { type: 'mark', kind: 'box', target: 'Save', area: SAVE },
      { type: 'mark', kind: 'arrow', target: 'Save', area: SAVE },
      { type: 'mark', kind: 'highlight', target: 'Settings', area: { left: 40, top: 20, width: 300, height: 30 } },
      { type: 'mark', kind: 'label', number: 2, target: 'Save', area: SAVE },
    ]);
  });

  it('numbers labels on from the last one by default, starting again with the next answer', async () => {
    const { doc, model, conversation } = setupOnPage();
    model.respond(lookThenMarks({ name: 'Settings', kind: 'label' }, { name: 'Save', kind: 'label' }).script);
    await conversation.ask('What are the steps?');
    expect(marksOn(doc).map((m) => m.text)).toEqual(['1', '2']);

    model.respond(lookThenMarks({ name: 'Save', kind: 'label' }).script);
    await conversation.ask('And again?');
    expect(marksOn(doc).map((m) => m.text)).toEqual(['1']);
  });

  it('refuses an unknown kind of Mark', async () => {
    const { doc, model, events, conversation } = setupOnPage();
    const { script, calls } = lookThenMarks({ name: 'Save', kind: 'circle' });
    model.respond(script);
    await conversation.ask('Where?');
    expect(await calls[0]!.result).toMatchObject({ isError: true });
    expect(resultText(await calls[0]!.result)).toMatch(/box, arrow, highlight, label/);
    expect(marksOn(doc)).toEqual([]);
    expect(events.some((e) => e.type === 'mark')).toBe(false);
  });

  it('marks an area of the visible page when there is no element to point at', async () => {
    const { doc, model, events, conversation } = setupOnPage();
    const spike = { left: 600, top: 120, width: 40, height: 60 };
    const { script, calls } = lookThenMarks({ kind: 'box', area: spike }, { kind: 'arrow', area: spike });
    model.respond(script);
    await conversation.ask('Where is the spike?');

    for (const call of calls) expect((await call.result).isError).toBeFalsy();
    const [box, arrow] = marksOn(doc);
    expect(box!.left).toBeLessThanOrEqual(600);
    expect(box!.top).toBeLessThanOrEqual(120);
    expect(box!.left + box!.width).toBeGreaterThanOrEqual(640);
    expect(box!.top + box!.height).toBeGreaterThanOrEqual(180);
    expect(arrow!.left + arrow!.width).toBeLessThanOrEqual(600);
    // The Panel hears of an area of the page, with no element name.
    expect(events.filter((e) => e.type === 'mark')).toEqual([
      { type: 'mark', kind: 'box', area: spike },
      { type: 'mark', kind: 'arrow', area: spike },
    ]);
  });

  it('keeps an area to the visible page, and refuses one wholly outside it', async () => {
    const { doc, model, events, conversation } = setupOnPage();
    const { script, calls } = lookThenMarks(
      { kind: 'highlight', area: { left: 1000, top: -20, width: 100, height: 60 } },
      { kind: 'box', area: { left: 10, top: 900, width: 50, height: 50 } },
      { kind: 'box', area: { left: 10, top: 10, width: 0, height: 50 } },
      { kind: 'box', area: { left: 10, top: 10, width: 10, height: 10 }, element: 'e1' },
    );
    model.respond(script);
    await conversation.ask('Where?');

    expect((await calls[0]!.result).isError).toBeFalsy();
    expect(marksOn(doc)).toEqual([expect.objectContaining({ kind: 'highlight', left: 1000, top: 0, width: 24, height: 40 })]);
    expect(await calls[1]!.result).toMatchObject({ isError: true });
    expect(resultText(await calls[1]!.result)).toMatch(/outside the visible page/);
    expect(await calls[2]!.result).toMatchObject({ isError: true });
    expect(await calls[3]!.result).toMatchObject({ isError: true });
    expect(events.filter((e) => e.type === 'mark')).toHaveLength(1);
  });

  it('lists a frame embedded from another site as one element, so a Mark can point at it as a whole', async () => {
    const { doc, model, events, conversation } = setupOnPage(`
      <h1>Watch</h1>
      <iframe src="https://video.example/embed/1" title="Product video" data-rect="40,300,480,270"></iframe>`);
    const frame = doc.querySelector('iframe')!;
    // Whatever the frame holds stays out of reach, even if the page could see into it.
    const inner = frame.contentDocument!;
    if (!inner.documentElement) inner.append(inner.createElement('html'));
    inner.documentElement!.innerHTML = '<body><button>Buy now</button><a href="/x">Inside link</a></body>';
    const { script, look, calls } = lookThenMarks({ name: 'Product video', kind: 'box' });
    model.respond(script);
    await conversation.ask('Which video?');

    const seen = resultText(await look.result);
    expect(seen.match(/iframe/g)).toHaveLength(1);
    expect(seen).toMatch(/iframe "Product video"/);
    expect(seen).not.toMatch(/Buy now|Inside link/);
    expect((await calls[0]!.result).isError).toBeFalsy();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'mark', target: 'Product video', area: { left: 40, top: 300, width: 480, height: 270 } }),
    );
    expect(marksOn(doc)).toHaveLength(1);
  });

  it('keeps element Marks on their element as the page scrolls and the window resizes', async () => {
    const { doc, model, conversation } = setupOnPage();
    model.respond(lookThenMarks({ name: 'Save', kind: 'highlight' }, { name: 'Save', kind: 'arrow' }).script);
    await conversation.ask('Where is Save?');
    const save = doc.querySelector('button')!;
    const view = doc.defaultView!;

    save.setAttribute('data-rect', '400,50,80,30');
    scrollWindow(doc, 0, 150);
    expect(marksOn(doc)[0]).toMatchObject({ left: 400, top: 50, width: 80, height: 30 });
    expect(marksOn(doc)[1]!.top).toBeLessThan(65);
    expect(marksOn(doc)[1]!.top + marksOn(doc)[1]!.height).toBeGreaterThan(65);

    // Scrolling inside a scroller on the page moves it too.
    save.setAttribute('data-rect', '400,10,80,30');
    doc.body.dispatchEvent(new view.Event('scroll'));
    expect(marksOn(doc)[0]).toMatchObject({ top: 10 });

    save.setAttribute('data-rect', '200,10,60,24');
    view.dispatchEvent(new view.Event('resize'));
    expect(marksOn(doc)[0]).toMatchObject({ left: 200, top: 10, width: 60, height: 24 });

    // An element that leaves the page takes its Marks with it.
    save.remove();
    view.dispatchEvent(new view.Event('resize'));
    expect(marksOn(doc).map((m) => m.visible)).toEqual([false, false]);
  });

  it('keeps a Mark at an area with the page as it scrolls', async () => {
    const { doc, model, conversation } = setupOnPage();
    model.respond(lookThenMarks({ kind: 'highlight', area: { left: 600, top: 400, width: 40, height: 60 } }).script);
    await conversation.ask('Where is the spike?');

    scrollWindow(doc, 0, 100);
    expect(marksOn(doc)[0]).toMatchObject({ left: 600, top: 300, width: 40, height: 60 });
    scrollWindow(doc, 30, 0);
    expect(marksOn(doc)[0]).toMatchObject({ left: 570, top: 400 });
  });

  it('hides Marks during Selection Mode, including ones drawn meanwhile, and brings them back after', async () => {
    const { doc, pageTools, model, conversation } = setupOnPage();
    model.respond(lookThenMarks({ name: 'Save', kind: 'box' }).script);
    await conversation.ask('Where is Save?');
    expect(marksOn(doc).map((m) => m.visible)).toEqual([true]);

    pageTools.setMarksHidden(true);
    expect(marksOn(doc).map((m) => m.visible)).toEqual([false]);
    // An answer still streaming may draw while the user selects.
    model.respond(lookThenMarks({ name: 'Settings', kind: 'arrow' }).script);
    await conversation.ask('And the heading?');
    expect(marksOn(doc).map((m) => m.visible)).toEqual([false]);

    pageTools.setMarksHidden(false);
    expect(marksOn(doc).map((m) => [m.kind, m.visible])).toEqual([['arrow', true]]);
  });
});

describe('Conversation: looking at the page as an image', () => {
  const PAGE = `
    <h1>Usage</h1>
    <canvas aria-label="Requests per day"></canvas>
    <button data-rect="40,200,80,30">Export</button>`;

  /** A captured still of the visible page, as the Background returns it. */
  const STILL = 'data:image/jpeg;base64,c3RpbGw=';

  function setupLooking(capture: CaptureVisiblePage = async () => ({ ok: true, dataUrl: STILL })) {
    const doc = pageDocument(PAGE);
    const captures = vi.fn(capture);
    const pageTools = createPageTools(doc, { drawOnPage: true }, { capture: captures });
    return { doc, captures, ...setup({ pageTools }) };
  }

  it('returns an image of the visible page alongside the element list when asked for one', async () => {
    const { model, events, captures, conversation } = setupLooking();
    const look = pageToolCall('look', { image: true });
    model.respond([look, ...response([text('The spike is on Tuesday.')])]);
    await conversation.ask('What happened in this chart?');

    const result = await look.result;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toMatch(/button "Export"/);
    expect(result.content).toContainEqual({ type: 'image', data: 'c3RpbGw=', mimeType: 'image/jpeg' });
    expect(captures).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('returns text only, and takes no image, without the option', async () => {
    const { model, captures, conversation } = setupLooking();
    const look = pageToolCall('look');
    const lookNo = pageToolCall('look', { image: false });
    model.respond([look, lookNo, ...response([text('ok')])]);
    await conversation.ask('What is here?');

    for (const result of [await look.result, await lookNo.result]) {
      expect(result.content.every((part) => part.type === 'text')).toBe(true);
      expect(resultText(result)).toMatch(/button "Export"/);
    }
    expect(captures).not.toHaveBeenCalled();
  });

  it('offers the image as an option of look', () => {
    const look = offeredPageTools({ drawOnPage: true }).find((tool) => tool.name === 'look')!;
    expect(look.inputSchema.properties).toHaveProperty('image');
  });

  it('keeps the Marks out of the image, and puts them back afterwards', async () => {
    let marksInImage = -1;
    const { doc, model, conversation } = setupLooking(async () => {
      marksInImage = marksShowing(doc);
      return { ok: true, dataUrl: STILL };
    });
    const firstLook = pageToolCall('look');
    let mark: ScriptedPageToolCall | undefined;
    const look = pageToolCall('look', { image: true });
    model.respond(async function* () {
      yield firstLook;
      mark = pageToolCall('mark', { element: refOf(await firstLook.result, 'Export') });
      yield mark;
      yield look;
      yield* response([text('ok')]);
    });
    await conversation.ask('Where is export?');

    const marked = await mark!.result;
    expect(marked.isError).toBeFalsy();
    // Only look returns an image.
    expect(marked.content.every((part) => part.type === 'text')).toBe(true);
    expect((await look.result).isError).toBeFalsy();
    expect(marksInImage).toBe(0);
    expect(marksShowing(doc)).toBe(1);
  });

  it('never takes the image while Selection Mode is showing', async () => {
    const { doc, model, events, captures, conversation } = setupLooking();
    doc.documentElement.append(doc.createElement('browser-click-overlay'));
    const look = pageToolCall('look', { image: true });
    model.respond([look, ...response([text('I could not see it.')])]);
    await conversation.ask('What is in this chart?');

    const result = await look.result;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/selection mode/i);
    expect(result.content.some((part) => part.type === 'image')).toBe(false);
    expect(captures).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it.each([
    ['fails', async () => ({ ok: false as const, error: 'The tab is not allowed to be captured.' }), /not allowed to be captured/],
    [
      'throws',
      async (): Promise<CaptureResponse> => {
        throw new Error('Extension context invalidated.');
      },
      /Extension context invalidated/,
    ],
    ['returns an image too large to send', async () => ({ ok: true as const, dataUrl: `data:image/jpeg;base64,${'A'.repeat(2_000_000)}` }), /too large/i],
  ])('tells the Assistant why when the capture %s, and the answer carries on', async (_, capture, reason) => {
    const { model, events, conversation } = setupLooking(capture);
    const look = pageToolCall('look', { image: true });
    model.respond([look, ...response([text('I can only read the element list.')])]);
    await conversation.ask('What is in this chart?');

    const result = await look.result;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(reason);
    expect(result.content.some((part) => part.type === 'image')).toBe(false);
    expect(events).toContainEqual({ type: 'text', text: expect.any(String) });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('tells the Assistant why when no capture is available', async () => {
    const doc = pageDocument(PAGE);
    const { model, events, conversation } = setup({ pageTools: createPageTools(doc, { drawOnPage: true }) });
    const look = pageToolCall('look', { image: true });
    model.respond([look, ...response([text('ok')])]);
    await conversation.ask('What is in this chart?');

    expect(await look.result).toMatchObject({ isError: true });
    expect(resultText(await look.result)).toMatch(/image/i);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
