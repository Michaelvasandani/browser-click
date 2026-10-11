import type Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelStreamItem, StreamParams } from '../conversation';

type Block = Anthropic.ContentBlock;

/** Stream events and final message for a response made of the given blocks. */
export function response(
  blocks: Block[],
  { stopReason = 'end_turn', id = 'msg_1' }: { stopReason?: Anthropic.StopReason; id?: string } = {},
): ModelStreamItem[] {
  const message: Anthropic.Message = {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: blocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 } as Anthropic.Usage,
  } as Anthropic.Message;
  const events: Anthropic.RawMessageStreamEvent[] = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
  ];
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } });
      // Split text into two deltas to exercise streaming.
      const mid = Math.ceil(block.text.length / 2);
      for (const part of [block.text.slice(0, mid), block.text.slice(mid)]) {
        if (part) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
      }
    } else {
      events.push({ type: 'content_block_start', index, content_block: block } as Anthropic.RawMessageStreamEvent);
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 10 },
  } as Anthropic.RawMessageStreamEvent);
  events.push({ type: 'message_stop' });
  return [...events.map((event) => ({ type: 'event' as const, event })), { type: 'message', message }];
}

export const text = (value: string): Block => ({ type: 'text', text: value, citations: null }) as Block;

type Script = ModelStreamItem[] | Error | ((signal: AbortSignal) => AsyncIterable<ModelStreamItem>);

/** A model client that plays back scripted responses and records each request. */
export class FakeModel implements ModelClient {
  requests: StreamParams[] = [];
  private scripts: Script[] = [];

  /** Queue the next response. */
  respond(script: Script) {
    this.scripts.push(script);
    return this;
  }

  async *stream(params: StreamParams, signal: AbortSignal): AsyncIterable<ModelStreamItem> {
    // Snapshot the request: the Conversation must not mutate what it sent.
    this.requests.push(structuredClone(params));
    const script = this.scripts.shift();
    if (!script) throw new Error('FakeModel: no response scripted');
    if (script instanceof Error) throw script;
    if (typeof script === 'function') {
      yield* script(signal);
      return;
    }
    for (const item of script) yield item;
  }

  get lastRequest(): StreamParams {
    const request = this.requests[this.requests.length - 1];
    if (!request) throw new Error('FakeModel: no request made');
    return request;
  }
}

/** The content blocks of message `index` in a request. */
export function contentOf(request: StreamParams, index: number): Anthropic.ContentBlockParam[] {
  const message = request.messages.at(index);
  if (!message) throw new Error(`no message at ${index}`);
  return typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
}
