import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { browser } from 'wxt/browser';
import type { PageToBackgroundMessage } from '@/lib/messages';
import { MAX_PAGE_TEXT_CHARS } from '@/lib/page-context';
import type { PageStep, PanelStore, SelectionView, TurnView } from '../store';
import { Answer } from './Answer';

export interface PanelProps {
  store: PanelStore;
  onClose: () => void;
  onAddSelection: () => void;
}

export function Panel({ store, onClose, onAddSelection }: PanelProps) {
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
    <section
      className="panel"
      aria-label="browser-click"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="header" title="Drag to move">
        <span className="title">Ask about this</span>
        <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="body" ref={bodyRef} onScroll={onScroll}>
        {state.turns.map((turn, index) => (
          <Turn
            key={turn.id}
            turn={turn}
            onRetry={index === state.turns.length - 1 && !state.busy ? () => void store.retry() : undefined}
          />
        ))}
        {state.pending.length > 0 && (
          <div className="pending">
            {state.turns.length > 0 && <p className="pending-label">Added to your next question</p>}
            <Thumbnails selections={state.pending} />
          </div>
        )}
        {state.notice && (
          <p className="error" role="alert">
            {state.notice}
          </p>
        )}
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
          <button
            type="button"
            className="secondary"
            title="Select another part of the page to ask about"
            onClick={onAddSelection}
          >
            Add selection
          </button>
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

function openOptions() {
  const message: PageToBackgroundMessage = { type: 'open-options' };
  void browser.runtime.sendMessage(message).catch(() => {});
}

/** One line for a Mark: "Marked *Save*", "Pointed at an area of the page", "Labelled *Save* 2". */
function MarkStep({ step }: { step: PageStep }) {
  const target = step.target ? <em>{step.target}</em> : 'an area of the page';
  switch (step.mark) {
    case 'arrow':
      return <>Pointed at {target}</>;
    case 'highlight':
      return <>Highlighted {target}</>;
    case 'label':
      return (
        <>
          Labelled {target} {step.number}
        </>
      );
    default:
      return <>Marked {target}</>;
  }
}

// Memoised: while an answer streams, only the turn that changed re-renders.
const Turn = memo(function Turn({ turn, onRetry }: { turn: TurnView; onRetry?: () => void }) {
  const sources = webSources(turn);
  return (
    <article className="turn" data-status={turn.status}>
      {turn.selections.length > 0 && <Thumbnails selections={turn.selections} />}
      <p className="user-question">{turn.question}</p>
      {turn.answer && <Answer text={turn.answer} />}
      {turn.steps.map((step, index) => (
        <p key={index} className="status page-step">
          <MarkStep step={step} />
        </p>
      ))}
      {(turn.searching || turn.status === 'waiting') && (
        <p className="status waiting" role="status">
          <span className="dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {turn.searching ? 'Searching the web…' : 'Thinking'}
        </p>
      )}
      {sources.length > 0 && (
        <div className="sources">
          <p className="sources-label">Sources</p>
          <ol>
            {sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>
                  {source.title}
                </a>
                <span className="host">{source.host}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {turn.status === 'stopped' && <p className="status">Stopped.</p>}
      {(turn.status === 'error' || turn.status === 'refused') && (
        <div className={turn.status === 'error' ? 'error' : 'refusal'} role="alert">
          <p>{turn.error}</p>
          <div className="error-actions">
            {onRetry && (
              <button type="button" className="secondary" onClick={onRetry}>
                Retry
              </button>
            )}
            {turn.fixInOptions && (
              <button type="button" className="secondary" onClick={openOptions}>
                Open options
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
});

/** Sources with web links only: anything else (javascript:, data:…) is never linked. */
function webSources(turn: TurnView) {
  return turn.sources.flatMap((source) => {
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
      return [{ ...source, host: url.hostname.replace(/^www\./, '') }];
    } catch {
      return [];
    }
  });
}
