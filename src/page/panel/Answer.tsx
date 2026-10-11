import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Links open in a new tab; raw HTML in answers is never rendered (react-markdown escapes it).
// Images are shown as links, never loaded: text injected into a page could otherwise
// get the model to emit an image URL that leaks the Conversation when fetched.
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: ({ src, alt }) =>
    typeof src === 'string' && /^https?:/i.test(src) ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || 'image'}
      </a>
    ) : (
      <span>{alt}</span>
    ),
};

/** Renders answer Markdown. Re-parsed on every update, so partial Markdown renders while streaming. */
export const Answer = memo(function Answer({ text }: { text: string }) {
  return (
    <div className="answer">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
