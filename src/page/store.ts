import type { CapturedImage } from './overlay';

export interface SelectionView {
  id: number;
  image: CapturedImage;
}

export interface PanelState {
  /** Selections attached to the next question. */
  pending: SelectionView[];
}

/** UI state of one open Panel, rendered by React via useSyncExternalStore. */
export class PanelStore {
  private state: PanelState = { pending: [] };
  private listeners = new Set<() => void>();
  private nextSelectionId = 1;

  constructor(firstSelection: CapturedImage) {
    this.addSelection(firstSelection);
  }

  getState = (): PanelState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  addSelection(image: CapturedImage) {
    this.update({ pending: [...this.state.pending, { id: this.nextSelectionId++, image }] });
  }

  private update(patch: Partial<PanelState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
