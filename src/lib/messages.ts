/** Messages exchanged between the Background and the page code it injects. */

/** Background → page: the user clicked the toolbar icon. */
export interface BeginSelectionMessage {
  type: 'begin-selection';
  /** True when started from the toolbar icon: the Selection starts a new Conversation. */
  fresh: boolean;
}

export type BackgroundToPageMessage = BeginSelectionMessage;

/** Page → Background: capture the visible tab as a still. */
export interface CaptureRequest {
  type: 'capture';
}

export type CaptureResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

export type PageToBackgroundMessage = CaptureRequest;
