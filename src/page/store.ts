import { Conversation, type ConversationEvent, type ModelClient, type Source } from '@/lib/conversation';
import type { PageSettings } from '@/lib/messages';
import type { PageContext } from '@/lib/page-context';
import type { CapturedImage } from './overlay';

export interface SelectionView {
  id: number;
  image: CapturedImage;
  /** The page text sent with this Selection was cut off for length. */
  pageTextTruncated: boolean;
}

export type TurnStatus = 'waiting' | 'streaming' | 'done' | 'stopped' | 'error' | 'refused';

export interface TurnView {
  id: number;
  question: string;
  selections: SelectionView[];
  answer: string;
  status: TurnStatus;
  /** A web search is running. */
  searching: boolean;
  sources: Source[];
  /** Why the turn failed or was declined, in plain words. */
  error?: string;
  /** The failure is about settings the user can change in options. */
  fixInOptions?: boolean;
}

export interface PanelState {
  /** Selections attached to the next question. */
  pending: SelectionView[];
  turns: TurnView[];
  /** True while an answer is being generated. */
  busy: boolean;
  /** A message about the Panel itself, such as lost access to the tab. */
  notice: string | null;
}

/**
 * UI state of one open Panel and the Conversation behind it. React renders it
 * via useSyncExternalStore; the Conversation's events are folded in here.
 */
export class PanelStore {
  private state: PanelState = { pending: [], turns: [], busy: false, notice: null };
  private listeners = new Set<() => void>();
  private selections = new Map<number, SelectionView>();
  private nextTurnId = 1;
  readonly conversation: Conversation;

  constructor(
    firstSelection: CapturedImage,
    firstPageContext: PageContext,
    settings: PageSettings,
    client: ModelClient,
  ) {
    this.conversation = new Conversation({
      client,
      model: settings.model,
      webSearch: settings.webSearch,
      onEvent: (event) => this.onConversationEvent(event),
    });
    this.addSelection(firstSelection, firstPageContext);
  }

  getState = (): PanelState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  addSelection(image: CapturedImage, pageContext: PageContext) {
    const view: SelectionView = { id: 0, image, pageTextTruncated: pageContext.truncated };
    view.id = this.conversation.addSelection({
      image: { mediaType: image.mediaType, data: image.data },
      pageContext,
    });
    this.selections.set(view.id, view);
    this.update({ pending: [...this.state.pending, view] });
  }

  setNotice(notice: string | null) {
    this.update({ notice });
  }

  ask(question: string) {
    return this.run(() => this.conversation.ask(question));
  }

  explain() {
    return this.run(() => this.conversation.explain());
  }

  stop() {
    this.conversation.stop();
  }

  /** Re-send the failed or declined question in place of its turn. */
  retry() {
    if (!this.conversation.canRetry || this.state.busy) return;
    this.update({ turns: this.state.turns.slice(0, -1) });
    return this.run(() => this.conversation.retry());
  }

  private async run(action: () => Promise<void>) {
    if (this.state.busy) return;
    this.update({ busy: true });
    try {
      await action();
    } catch (error) {
      // The Conversation reports model failures as events; this is a last resort.
      this.updateLastTurn({ status: 'error', error: error instanceof Error ? error.message : String(error), searching: false });
    } finally {
      this.update({ busy: false });
    }
  }

  private onConversationEvent(event: ConversationEvent) {
    switch (event.type) {
      case 'turn-started': {
        const selections = event.selectionIds.map((id) => this.selections.get(id)!);
        const turn: TurnView = {
          id: this.nextTurnId++,
          question: event.question,
          selections,
          answer: '',
          status: 'waiting',
          searching: false,
          sources: [],
        };
        this.update({
          turns: [...this.state.turns, turn],
          pending: this.state.pending.filter((s) => !event.selectionIds.includes(s.id)),
        });
        break;
      }
      case 'text': {
        const turn = this.state.turns.at(-1);
        if (turn) this.updateLastTurn({ answer: turn.answer + event.text, status: 'streaming' });
        break;
      }
      case 'searching':
        this.updateLastTurn({ searching: event.active });
        break;
      case 'sources':
        this.updateLastTurn({ sources: event.sources });
        break;
      case 'error':
        this.updateLastTurn({
          status: 'error',
          error: event.message,
          searching: false,
          fixInOptions: event.kind === 'auth' || event.kind === 'web_search' || event.kind === 'claude_code_setup',
        });
        this.syncPending();
        break;
      case 'refusal':
        this.updateLastTurn({ status: 'refused', error: event.message, searching: false });
        this.syncPending();
        break;
      case 'page-text-truncated':
        // Already known from the Page Context; shown with the thumbnail.
        break;
      case 'done':
        this.updateLastTurn({ status: 'done' });
        break;
      case 'stopped':
        this.updateLastTurn({ status: 'stopped' });
        break;
    }
  }

  /** Selections the Conversation will send with the next question. */
  private syncPending() {
    this.update({ pending: this.conversation.pendingSelectionIds.map((id) => this.selections.get(id)!) });
  }

  private updateLastTurn(patch: Partial<TurnView>) {
    const turns = this.state.turns.slice();
    const last = turns.at(-1);
    if (!last) return;
    turns[turns.length - 1] = { ...last, ...patch };
    this.update({ turns });
  }

  private update(patch: Partial<PanelState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
