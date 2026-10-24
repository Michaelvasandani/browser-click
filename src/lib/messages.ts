/** Messages exchanged between the Background and the page code it injects. */
import type { ModelErrorKind, ModelStreamItem, StreamParams } from './conversation';
import type { Backend, ModelId } from './settings';

/** Settings the page code needs. The API key never leaves the Background. */
export interface PageSettings {
  backend: Backend;
  model: ModelId;
  webSearch: boolean;
}

/** Background → page: the user clicked the toolbar icon. */
export interface BeginSelectionMessage {
  type: 'begin-selection';
  /** True when started from the toolbar icon: the Selection starts a new Conversation. */
  fresh: boolean;
  settings: PageSettings;
}

export type BackgroundToPageMessage = BeginSelectionMessage;

/** Page → Background: capture the visible tab as a still. */
export interface CaptureRequest {
  type: 'capture';
}

export type CaptureResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Page → Background: open the options page (page code cannot). */
export interface OpenOptionsRequest {
  type: 'open-options';
}

/** Options page → Background: check that the Claude Code host is installed and claude is signed in. */
export interface CheckClaudeCodeRequest {
  type: 'check-claude-code';
}

export type ClaudeCodeCheck =
  | { ok: true; version: string; loggedIn: boolean }
  | { ok: false; message: string };

export type PageToBackgroundMessage = CaptureRequest | OpenOptionsRequest | CheckClaudeCodeRequest;

/** Name of the long-lived port the page uses to stream one model response. */
export const MODEL_PORT = 'model';

/** Page → Background over the model port. */
export interface ModelPortRequest {
  type: 'start';
  params: StreamParams;
}

/** Background → page over the model port. */
export type ModelPortMessage =
  | { type: 'item'; item: ModelStreamItem }
  | { type: 'error'; kind: ModelErrorKind; message: string }
  | { type: 'end' };

/**
 * Name of the port the page keeps open for a Conversation on the Claude Code
 * backend. It lives as long as the Panel, and so does the claude process behind it.
 */
export const CLAUDE_CODE_PORT = 'claude-code';

/** Page → Background over the Claude Code port. */
export type ClaudeCodePortRequest =
  /** First message: start claude for this Conversation (or resume its saved session). */
  | { type: 'open'; model: ModelId; webSearch: boolean; title: string; sessionId?: string }
  /** Send the newest user message; claude keeps the history itself. */
  | { type: 'ask'; content: ClaudeCodeUserContent }
  /** Interrupt the answer being generated. */
  | { type: 'stop' };

export type ClaudeCodeUserContent = Exclude<StreamParams['messages'][number]['content'], string>;

/** Background → page over the Claude Code port: the current answer's stream, plus the session's ID. */
export type ClaudeCodePortMessage = ModelPortMessage | { type: 'session'; sessionId: string };
