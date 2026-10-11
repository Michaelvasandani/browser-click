import { useSyncExternalStore } from 'react';
import type { PanelStore } from '../store';

export interface PanelProps {
  store: PanelStore;
  onClose: () => void;
}

export function Panel({ store, onClose }: PanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState);

  return (
    <section className="panel" aria-label="browser-click">
      <header className="header">
        <span className="title">Ask about this</span>
        <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="body">
        {state.pending.length > 0 && (
          <div className="thumbs">
            {state.pending.map((selection) => (
              <img key={selection.id} className="thumb" src={selection.image.dataUrl} alt="Your Selection" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
