import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { MAX_PAGE_TEXT_CHARS } from '@/lib/page-context';
import type { PanelStore, SelectionView, TurnView } from '../store';
import { Answer } from './Answer';

export interface PanelProps {
  store: PanelStore;
  onClose: () => void;
}

export function Panel({ store, onClose }: PanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const turnCount = useRef(state.turns.length);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Follow the Conversation as it grows, unless the reader scrolled up to reread.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const newTurn = state.turns.length !== turnCount.current;
    turnCount.current = state.turns.length;
    if (newTurn || stickToBottom.current) body.scrollTop = body.scrollHeight;
  }, [state]);

  const onScroll = () => {
    const body = bodyRef.current;
    if (body) stickToBottom.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (!text || state.busy) return;
    setQuestion('');
    void store.ask(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <section className="panel" aria-label="browser-click">
      <header className="header">
        <span className="title">Ask about this</span>
        <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="body" ref={bodyRef} onScroll={onScroll}>
        {state.turns.map((turn) => (
          <Turn key={turn.id} turn={turn} />
        ))}
        {state.pending.length > 0 && <Thumbnails selections={state.pending} />}
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          className="question"
          rows={2}
          placeholder={state.turns.length ? 'Ask a follow-up…' : 'What confuses you about this?'}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="actions">
          {state.pending.length > 0 && (
            <button type="button" className="secondary" disabled={state.busy} onClick={() => void store.explain()}>
              Explain this
            </button>
          )}
          <span className="spacer" />
          {state.busy ? (
            <button type="button" className="secondary stop" onClick={() => store.stop()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!question.trim()}>
              Ask
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function Thumbnails({ selections }: { selections: SelectionView[] }) {
  return (
    <div className="thumbs">
      {selections.map((selection) => (
        <img key={selection.id} className="thumb" src={selection.image.dataUrl} alt={`Selection ${selection.id}`} />
      ))}
      {selections.some((s) => s.pageTextTruncated) && (
        <p className="note">This page is long, so Claude will only see the first{' '}
          {MAX_PAGE_TEXT_CHARS.toLocaleString('en-US')} characters of its text.</p>
      )}
    </div>
  );
}

function Turn({ turn }: { turn: TurnView }) {
  return (
    <article className="turn" data-status={turn.status}>
      {turn.selections.length > 0 && <Thumbnails selections={turn.selections} />}
      <p className="user-question">{turn.question}</p>
      {turn.status === 'waiting' && (
        <p className="status waiting" role="status">
          <span className="dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Thinking
        </p>
      )}
      {turn.answer && <Answer text={turn.answer} />}
      {turn.status === 'stopped' && <p className="status">Stopped.</p>}
      {turn.status === 'error' && (
        <p className="error" role="alert">
          {turn.error}
        </p>
      )}
    </article>
  );
}
