import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Links open in a new tab; raw HTML in answers is never rendered (react-markdown escapes it).
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
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
