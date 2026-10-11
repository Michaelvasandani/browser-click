import { Conversation, type ConversationEvent, type ModelClient } from '@/lib/conversation';
import type { PageSettings } from '@/lib/messages';
import type { PageContext } from '@/lib/page-context';
import type { CapturedImage } from './overlay';

export interface SelectionView {
  id: number;
  image: CapturedImage;
  /** The page text sent with this Selection was cut off for length. */
  pageTextTruncated: boolean;
}

export type TurnStatus = 'waiting' | 'streaming' | 'done' | 'stopped' | 'error';

export interface TurnView {
  id: number;
  question: string;
  selections: SelectionView[];
  answer: string;
  status: TurnStatus;
  error?: string;
}

export interface PanelState {
  /** Selections attached to the next question. */
  pending: SelectionView[];
  turns: TurnView[];
  /** True while an answer is being generated. */
  busy: boolean;
}

/**
 * UI state of one open Panel and the Conversation behind it. React renders it
 * via useSyncExternalStore; the Conversation's events are folded in here.
 */
export class PanelStore {
  private state: PanelState = { pending: [], turns: [], busy: false };
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

  ask(question: string) {
    return this.run(() => this.conversation.ask(question));
  }

  explain() {
    return this.run(() => this.conversation.explain());
  }

  stop() {
    this.conversation.stop();
  }

  private async run(action: () => Promise<void>) {
    if (this.state.busy) return;
    this.update({ busy: true });
    try {
      await action();
    } catch (error) {
      this.updateLastTurn({ status: 'error', error: error instanceof Error ? error.message : String(error) });
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
