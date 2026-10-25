import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { ModelPortMessage } from '@/lib/messages';
import { classifyClaudeCodeError, ClaudeCodeTurns, type ClaudeCodeOutput } from './claude-code';

const streamEvent = (event: object): ClaudeCodeOutput => ({
  type: 'stream_event',
  event: event as Anthropic.RawMessageStreamEvent,
});
const textStart = streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
const textDelta = (text: string) =>
  streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
const assistant = (text: string, stopReason = 'end_turn'): ClaudeCodeOutput => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }], stop_reason: stopReason } as Anthropic.Message,
});
const success: ClaudeCodeOutput = { type: 'result', subtype: 'success', is_error: false, result: 'done' };

function play(turns: ClaudeCodeTurns, outputs: ClaudeCodeOutput[]): ModelPortMessage[] {
  return outputs.flatMap((output) => turns.output(output));
}

const texts = (messages: ModelPortMessage[]) =>
  messages.flatMap((m) =>
    m.type === 'item' && m.item.type === 'event' && m.item.event.type === 'content_block_delta' && m.item.event.delta.type === 'text_delta'
      ? [m.item.event.delta.text]
      : [],
  );

describe('ClaudeCodeTurns', () => {
  it('streams text and ends with a final message of the answer', () => {
    const turns = new ClaudeCodeTurns();
    turns.ask();
    const messages = play(turns, [textStart, textDelta('Hel'), textDelta('lo'), assistant('Hello'), success]);
    expect(texts(messages)).toEqual(['Hel', 'lo']);
    const final = messages.at(-2);
    expect(final).toMatchObject({ type: 'item', item: { type: 'message', message: { stop_reason: 'end_turn' } } });
    expect(final?.type === 'item' && final.item.type === 'message' && final.item.message.content).toEqual([
      { type: 'text', text: 'Hello', citations: null },
    ]);
    expect(messages.at(-1)).toEqual({ type: 'end' });
    expect(turns.busy).toBe(false);
  });

  it('shows a WebSearch call as a search and keeps the text of every assistant turn', () => {
    const turns = new ClaudeCodeTurns();
    turns.ask();
    const messages = play(turns, [
      textStart,
      textDelta('Let me look. '),
      streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'WebSearch', input: {} } }),
      assistant('Let me look. ', 'tool_use'),
      textStart,
      textDelta('Found it.'),
      assistant('Found it.'),
      success,
    ]);
    const starts = messages.flatMap((m) =>
      m.type === 'item' && m.item.type === 'event' && m.item.event.type === 'content_block_start'
        ? [m.item.event.content_block.type]
        : [],
    );
    expect(starts).toEqual(['text', 'server_tool_use', 'text']);
    const final = messages.at(-2);
    expect(final?.type === 'item' && final.item.type === 'message' && final.item.message).toMatchObject({
      content: [{ type: 'text', text: 'Let me look. Found it.' }],
      stop_reason: 'end_turn',
    });
  });

  it('passes a page tool call from the host to the page, and its result back to the host', () => {
    const turns = new ClaudeCodeTurns();
    turns.ask();
    const before = play(turns, [
      textStart,
      textDelta('Let me point at it. '),
      streamEvent({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 't1', name: 'mcp__browser-click__mark', input: {} },
      }),
      assistant('Let me point at it. ', 'tool_use'),
    ]);
    // claude's own view of the MCP call is not a search, and adds no text.
    expect(before.some((m) => m.type === 'item' && m.item.type === 'event' && m.item.event.type === 'content_block_start' && m.item.event.content_block.type === 'server_tool_use')).toBe(false);

    const call = { callId: 'c1', name: 'mark', input: { element: 'e2' } };
    expect(turns.pageToolCall(call)).toEqual([
      { type: 'page-tool-call', callId: 'c1', call: { name: 'mark', input: { element: 'e2' } } },
    ]);
    const result = { content: [{ type: 'text' as const, text: 'Marked e2.' }] };
    expect(turns.pageToolResult('c1', result)).toEqual([{ type: 'page-tool-result', callId: 'c1', result }]);
    // Each call is answered once.
    expect(turns.pageToolResult('c1', result)).toEqual([]);
    expect(turns.pageToolResult('unknown', result)).toEqual([]);

    const after = play(turns, [textStart, textDelta('There.'), assistant('There.'), success]);
    expect(texts(after)).toEqual(['There.']);
    expect(after.at(-1)).toEqual({ type: 'end' });
  });

  it('passes on a refusal', () => {
    const turns = new ClaudeCodeTurns();
    turns.ask();
    const messages = play(turns, [assistant('', 'refusal'), success]);
    expect(messages.at(-2)).toMatchObject({ item: { message: { stop_reason: 'refusal' } } });
  });

  it('reports a failed result as an error', () => {
    const turns = new ClaudeCodeTurns();
    turns.ask();
    const messages = play(turns, [
      assistant('Failed to authenticate: OAuth session expired'),
      { type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired' },
    ]);
    expect(messages).toEqual([
      { type: 'error', kind: 'claude_code_auth', message: 'Failed to authenticate: OAuth session expired' },
    ]);
  });

  it('drops a stopped answer until its result, then streams the next one', () => {
    const turns = new ClaudeCodeTurns();
    turns.ask();
    expect(play(turns, [textStart, textDelta('first')])).toHaveLength(2);
    expect(turns.stop()).toBe(true);
    // The next question is sent before claude reports the stopped one.
    turns.ask();
    const messages = play(turns, [
      textDelta(' more of first'),
      { type: 'result', subtype: 'error_during_execution', is_error: true },
      textStart,
      textDelta('second'),
      success,
    ]);
    expect(texts(messages)).toEqual(['second']);
    expect(messages.at(-1)).toEqual({ type: 'end' });
  });

  it('does not interrupt claude when no answer is running', () => {
    const turns = new ClaudeCodeTurns();
    expect(turns.stop()).toBe(false);
    turns.ask();
    play(turns, [success]);
    expect(turns.stop()).toBe(false);
  });

  it('fails the running answer when claude exits, and only that one', () => {
    const turns = new ClaudeCodeTurns();
    expect(turns.exit('gone')).toEqual([]);
    turns.ask();
    expect(turns.exit('Specified native messaging host not found.')).toEqual([
      { type: 'error', kind: 'claude_code_setup', message: 'Specified native messaging host not found.' },
    ]);
    expect(turns.busy).toBe(false);
  });
});

describe('classifyClaudeCodeError', () => {
  it.each([
    ['Not logged in · Please run /login', 'claude_code_auth'],
    ["Couldn't start claude: spawn claude ENOENT", 'claude_code_setup'],
    ['Access to the specified native messaging host is forbidden.', 'claude_code_setup'],
    ['Model claude-x not found', 'api'],
  ])('%s → %s', (message, kind) => {
    expect(classifyClaudeCodeError(message)).toEqual({ kind, message });
  });
});
