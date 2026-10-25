import { browser, type Browser } from 'wxt/browser';
import {
  ModelError,
  type ModelClient,
  type ModelStreamItem,
  type PageToolCallItem,
  type StreamParams,
} from '@/lib/conversation';
import {
  CLAUDE_CODE_PORT,
  type ClaudeCodePortMessage,
  type ClaudeCodePortRequest,
  type PageSettings,
} from '@/lib/messages';

export interface ClaudeCodeClient extends ModelClient {
  /** End the claude process behind this Conversation. */
  close(): void;
}

/**
 * A model client for one Conversation on the Claude Code backend. It opens its
 * port (and so starts claude) right away, while the user is still typing, and
 * keeps it for the Panel's lifetime. claude keeps the history itself, so each
 * question sends only the newest user message.
 */
export function openClaudeCodeClient(settings: PageSettings, title: string): ClaudeCodeClient {
  let port: Browser.runtime.Port | null = null;
  let sessionId: string | undefined;
  /** claude has answered, so its session is saved and a new port can resume it. */
  let resumeId: string | undefined;
  let closed = false;
  // The answer being streamed, if any.
  let queue: ClaudeCodePortMessage[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  const connect = () => {
    const opened = browser.runtime.connect({ name: CLAUDE_CODE_PORT });
    port = opened;
    opened.onMessage.addListener((message: ClaudeCodePortMessage) => {
      if (message.type === 'session') {
        sessionId = message.sessionId;
        return;
      }
      if (message.type === 'end') resumeId = sessionId;
      queue.push(message);
      notify();
    });
    opened.onDisconnect.addListener(() => {
      if (port === opened) port = null;
      notify();
    });
    const open: ClaudeCodePortRequest = {
      type: 'open',
      model: settings.model,
      webSearch: settings.webSearch,
      drawOnPage: settings.drawOnPage,
      title,
      sessionId: resumeId,
    };
    opened.postMessage(open);
    return opened;
  };
  connect();

  return {
    async *stream(params: StreamParams, signal: AbortSignal): AsyncIterable<ModelStreamItem> {
      const last = params.messages.at(-1);
      if (closed || !last || last.role !== 'user') throw new ModelError('api', 'Nothing to send.');
      const content = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : last.content;
      // Reconnect if the extension's worker restarted; the saved session is resumed.
      const active = port ?? connect();
      queue = [];
      const send = (request: ClaudeCodePortRequest) => active.postMessage(request);
      const onAbort = () => {
        if (port === active) send({ type: 'stop' });
        notify();
      };
      signal.addEventListener('abort', onAbort);
      try {
        send({ type: 'ask', content });
        while (true) {
          if (signal.aborted) return;
          const message = queue.shift();
          if (!message) {
            if (port !== active) throw new ModelError('network', 'Lost the connection to the extension.');
            await new Promise<void>((resolve) => (wake = resolve));
            continue;
          }
          if (message.type === 'item') yield message.item;
          else if (message.type === 'page-tool-call') yield pageToolCallItem(active, message);
          else if (message.type === 'error') throw new ModelError(message.kind, message.message);
          else if (message.type === 'end') return;
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },

    close() {
      closed = true;
      port?.disconnect();
      port = null;
      notify();
    },
  };
}

/** A page tool call from claude, answered over the port it came in on. */
function pageToolCallItem(
  port: Browser.runtime.Port,
  { callId, call }: Extract<ClaudeCodePortMessage, { type: 'page-tool-call' }>,
): PageToolCallItem {
  let answered = false;
  return {
    type: 'page-tool-call',
    call,
    respond(result) {
      if (answered) return;
      answered = true;
      const reply: ClaudeCodePortRequest = { type: 'page-tool-result', callId, result };
      try {
        port.postMessage(reply);
      } catch {
        // The port closed meanwhile: the answer is over, and so is this call.
      }
    },
  };
}
