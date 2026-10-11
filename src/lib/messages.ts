/** Messages exchanged between the Background and the page code it injects. */
import type { ModelErrorKind, ModelStreamItem, StreamParams } from './conversation';
import type { ModelId } from './settings';

/** Settings the page code needs. The API key never leaves the Background. */
export interface PageSettings {
  model: ModelId;
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

export type PageToBackgroundMessage = CaptureRequest;

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
