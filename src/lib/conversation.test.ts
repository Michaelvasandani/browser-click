import { describe, expect, it } from 'vitest';
import { Conversation, EXPLAIN_QUESTION, type ConversationEvent, type SelectionInput } from './conversation';
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
