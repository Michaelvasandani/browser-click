import type Anthropic from '@anthropic-ai/sdk';
import { browser, type Browser } from 'wxt/browser';
import { systemPrompt, type ModelErrorKind } from '@/lib/conversation';
import { offeredPageTools, type PageToolResult } from '@/lib/page-tools';
import {
  CLAUDE_CODE_PORT,
  type ClaudeCodeCheck,
  type ClaudeCodePortMessage,
  type ClaudeCodePortRequest,
  type ModelPortMessage,
} from '@/lib/messages';

/** The native messaging host installed by native-host/install.mjs. */
export const CLAUDE_CODE_HOST = 'com.browser_click.claude_code';

/** One line of `claude -p --output-format stream-json`, as forwarded by the host. */
export type ClaudeCodeOutput =
  | { type: 'system'; subtype: string; session_id?: string }
  | { type: 'stream_event'; event: Anthropic.RawMessageStreamEvent }
  | { type: 'assistant'; message: Anthropic.Message }
  | { type: 'result'; subtype: string; is_error?: boolean; result?: string; errors?: string[] };

/** A page tool call from claude, as the host's MCP server received it. `name` is the bare tool name. */
export interface HostPageToolCall {
  callId: string;
  name: string;
  input: unknown;
}

/** Host → Background. */
export type HostMessage =
  | { type: 'opened'; sessionId: string }
  | ({ type: 'page-tool-call' } & HostPageToolCall)
  | { type: 'output'; output: ClaudeCodeOutput }
  | { type: 'exit'; code: number | null; signal: string | null; stderr: string }
  | { type: 'error'; message: string };

/** Background → host, besides opening: questions, interrupts and page tool results. */
export type HostRequest =
  | { type: 'ask'; content: unknown }
  | { type: 'stop' }
  | { type: 'page-tool-result'; callId: string; result: PageToolResult };

/**
 * Turns claude's stream-json output for one Conversation into the stream items
 * the Conversation consumes, one answer at a time: text deltas pass through,
 * Claude Code's WebSearch calls show as searches, and each answer ends with a
 * final message built from its assistant turns. Output from an answer the user
 * stopped is dropped until claude reports that answer's result.
 *
 * Page tool calls reach it from the host's MCP server rather than from claude's
 * output (which only shows claude's side of the call): each goes to the page
 * with its call ID, and the page's result goes back to the host once.
 */
export class ClaudeCodeTurns {
  private active = false;
  /** Stopped answers whose result claude has yet to report. */
  private stoppedPending = 0;
  private text = '';
  private stopReason: Anthropic.StopReason = 'end_turn';
  private nextIndex = 0;
  private textIndex = 0;
  /** Page tool calls sent to the page and not yet answered. */
  private pendingCalls = new Set<string>();

  /** True while an answer is being generated for the page. */
  get busy() {
    return this.active;
  }

  ask() {
    this.active = true;
    this.text = '';
    this.stopReason = 'end_turn';
  }

  /**
   * The user stopped the answer. Returns the messages for the host: an
   * interrupt if an answer is running, and an error result for every page tool
   * call still waiting, so claude never waits for one forever.
   */
  stop(): HostRequest[] {
    const interrupt: HostRequest[] = [];
    if (this.active) {
      this.active = false;
      this.stoppedPending++;
      interrupt.push({ type: 'stop' });
    }
    return [...interrupt, ...this.abandonCalls(STOPPED_CALL)];
  }

  /** The page's port closed. Returns an error result for every page tool call still waiting. */
  close(): HostRequest[] {
    return this.abandonCalls(CLOSED_CALL);
  }

  /**
   * claude called a page tool. It goes to the page while an answer is running
   * for it; otherwise nothing there would answer, so it fails at once.
   */
  pageToolCall(call: HostPageToolCall): { toPage: ClaudeCodePortMessage[]; toHost: HostRequest[] } {
    if (!this.active || this.stoppedPending > 0) {
      return { toPage: [], toHost: [{ type: 'page-tool-result', callId: call.callId, result: errorResult(STOPPED_CALL) }] };
    }
    this.pendingCalls.add(call.callId);
    return {
      toPage: [{ type: 'page-tool-call', callId: call.callId, call: { name: call.name, input: call.input } }],
      toHost: [],
    };
  }

  private abandonCalls(why: string): HostRequest[] {
    const requests = [...this.pendingCalls].map(
      (callId): HostRequest => ({ type: 'page-tool-result', callId, result: errorResult(why) }),
    );
    this.pendingCalls.clear();
    return requests;
  }

  /** The page answered a page tool call. Returns the messages for the host. */
  pageToolResult(callId: string, result: PageToolResult): HostRequest[] {
    if (!this.pendingCalls.delete(callId)) return [];
    return [{ type: 'page-tool-result', callId, result }];
  }

  output(output: ClaudeCodeOutput): ModelPortMessage[] {
    if (output.type === 'result' && this.stoppedPending > 0) {
      this.stoppedPending--;
      return [];
    }
    if (!this.active || this.stoppedPending > 0) return [];

    switch (output.type) {
      case 'stream_event':
        return this.streamEvent(output.event);
      case 'assistant':
        for (const block of output.message.content) if (block.type === 'text') this.text += block.text;
        if (output.message.stop_reason) this.stopReason = output.message.stop_reason;
        return [];
      case 'result':
        this.active = false;
        if (output.is_error || output.subtype !== 'success') {
          const message = output.result || output.errors?.join(' ') || `Claude Code stopped (${output.subtype}).`;
          return [{ type: 'error', ...classifyClaudeCodeError(message) }];
        }
        return [{ type: 'item', item: { type: 'message', message: this.finalMessage() } }, { type: 'end' }];
      default:
        return [];
    }
  }

  /** claude exited (or the host went away). Fails the answer in progress, if any. */
  exit(reason: string): ModelPortMessage[] {
    this.stoppedPending = 0;
    // Whatever was waiting for them went with claude.
    this.pendingCalls.clear();
    if (!this.active) return [];
    this.active = false;
    return [{ type: 'error', ...classifyClaudeCodeError(reason) }];
  }

  private streamEvent(event: Anthropic.RawMessageStreamEvent): ModelPortMessage[] {
    // Each of Claude Code's API calls numbers its blocks from 0; the
    // Conversation only looks at block types and text, so renumber them.
    if (event.type === 'content_block_start') {
      const block = event.content_block;
      if (block.type === 'text') {
        this.textIndex = this.nextIndex++;
        return [this.event({ type: 'content_block_start', index: this.textIndex, content_block: block })];
      }
      if (block.type === 'tool_use' && block.name === 'WebSearch') {
        // Shown as the API's own web search so the Panel says it is searching.
        const search = { type: 'server_tool_use', id: block.id, name: 'web_search', input: {} } as Anthropic.ServerToolUseBlock;
        return [this.event({ type: 'content_block_start', index: this.nextIndex++, content_block: search })];
      }
      return [];
    }
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      return [this.event({ type: 'content_block_delta', index: this.textIndex, delta: event.delta })];
    }
    return [];
  }

  private event(event: Anthropic.RawMessageStreamEvent): ModelPortMessage {
    return { type: 'item', item: { type: 'event', event } };
  }

  private finalMessage(): Anthropic.Message {
    return {
      id: 'claude-code',
      type: 'message',
      role: 'assistant',
      model: 'claude-code',
      content: [{ type: 'text', text: this.text, citations: null }],
      stop_reason: this.stopReason,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as Anthropic.Message;
  }
}

const STOPPED_CALL = 'The reader stopped this answer, so this step did not happen.';
const CLOSED_CALL = 'The browser-click panel was closed or the page went away, so this step did not happen.';

const errorResult = (text: string): PageToolResult => ({ content: [{ type: 'text', text }], isError: true });

/** Sorts Claude Code's error text into the cases the Panel can explain. */
export function classifyClaudeCodeError(message: string): { kind: ModelErrorKind; message: string } {
  if (/not (logged|signed) in|authenticat|oauth|\/login/i.test(message)) return { kind: 'claude_code_auth', message };
  if (/native messaging host|couldn't start|ENOENT/i.test(message)) return { kind: 'claude_code_setup', message };
  return { kind: 'api', message };
}

/**
 * Serves the Claude Code port: each open port is one Conversation, bridged to
 * one copy of the native host and the claude process it runs. If claude exits
 * (or is killed), the next question starts it again on the saved session.
 */
export function listenForClaudeCodeSessions() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CLAUDE_CODE_PORT || port.sender?.id !== browser.runtime.id) return;
    serve(port);
  });

  browser.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
    if (message.type !== 'check-claude-code') return;
    checkClaudeCode().then(sendResponse);
    return true;
  });
}

function serve(port: Browser.runtime.Port) {
  const turns = new ClaudeCodeTurns();
  let open: Extract<ClaudeCodePortRequest, { type: 'open' }> | null = null;
  let host: Browser.runtime.Port | null = null;
  const toHost = (request: HostRequest) => host?.postMessage(request);
  let sessionId: string | undefined;
  /** claude has taken a question, so its session is saved and can be resumed. */
  let resumable = false;
  let closed = false;

  const post = (message: ClaudeCodePortMessage) => {
    if (!closed) port.postMessage(message);
  };

  const connect = () => {
    if (!open) return;
    const native = browser.runtime.connectNative(CLAUDE_CODE_HOST);
    host = native;
    native.onMessage.addListener((message: HostMessage) => {
      if (message.type === 'opened') {
        sessionId = message.sessionId;
        post({ type: 'session', sessionId });
      } else if (message.type === 'page-tool-call') {
        const { callId, name, input } = message;
        const { toPage, toHost: answers } = turns.pageToolCall({ callId, name, input });
        toPage.forEach(post);
        answers.forEach(toHost);
      } else if (message.type === 'output') {
        if (message.output.type === 'system' && message.output.subtype === 'init') resumable = true;
        turns.output(message.output).forEach(post);
      } else if (message.type === 'exit') {
        const why = message.stderr || `claude exited (${message.signal ?? message.code}).`;
        turns.exit(why).forEach(post);
      } else if (message.type === 'error') {
        turns.exit(message.message).forEach(post);
      }
    });
    native.onDisconnect.addListener(() => {
      if (host === native) host = null;
      const why = browser.runtime.lastError?.message ?? 'Claude Code stopped unexpectedly.';
      turns.exit(why).forEach(post);
    });
    const pageTools = offeredPageTools({ drawOnPage: open.drawOnPage, actOnPage: open.actOnPage });
    native.postMessage({
      type: 'open',
      model: open.model,
      webSearch: open.webSearch,
      // Served to claude by the host's MCP server; none means no MCP server at all.
      pageTools,
      systemPrompt: systemPrompt(pageTools),
      title: open.title,
      sessionId,
      resume: resumable,
    });
  };

  port.onMessage.addListener((request: ClaudeCodePortRequest) => {
    if (request.type === 'open') {
      if (open) return;
      open = request;
      sessionId = request.sessionId;
      resumable = request.sessionId !== undefined;
      // Start claude now, so it is ready by the time the user has typed a question.
      connect();
    } else if (request.type === 'ask') {
      if (turns.busy) return;
      if (!host) connect();
      turns.ask();
      toHost({ type: 'ask', content: request.content });
    } else if (request.type === 'stop') {
      turns.stop().forEach(toHost);
    } else if (request.type === 'page-tool-result') {
      turns.pageToolResult(request.callId, request.result).forEach(toHost);
    }
  });

  port.onDisconnect.addListener(() => {
    // The Panel closed or the page went away: end the claude process with it.
    closed = true;
    turns.close().forEach(toHost);
    host?.disconnect();
    host = null;
  });
}

async function checkClaudeCode(): Promise<ClaudeCodeCheck> {
  try {
    const reply = (await browser.runtime.sendNativeMessage(CLAUDE_CODE_HOST, { type: 'ping' })) as
      | { ok: true; version: string; loggedIn: boolean }
      | { ok: false; message: string };
    return reply;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
