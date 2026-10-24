# Let the Assistant draw on and act on the page, through page tools the native host serves over MCP

Supersedes [0002](0002-claude-code-backend.md) in part: on the Claude Code backend, `claude` is no longer limited to web search. It also gets browser-click's own page tools.

Answers alone often can't show the user where something is or do the obvious next step for them. We decided to let the Assistant draw Marks over the page and take Page Actions (scrolling, clicking, typing) on it, within the part of the page currently in view. The native host runs a small MCP server that `claude` reaches through `--mcp-config`, with `--strict-mcp-config` still set so it is the only one. Each tool call goes host → Background → page and the result comes back the same way. The tools are defined once in the page code, so the API key backend can offer the same tools later as client tools.

A page can now try to steer the Assistant: the Page Context is page text sent to the Assistant, and it can say "click Delete account". ADR 0002 prevented that by giving `claude` no tools. We accept the risk in exchange for these guards, all enforced in browser-click's own code rather than by the model:

- Marks and scrolling run freely. Each click or bit of typing waits for **Allow** in the Panel. If the user denies it, types a new question or doesn't answer, the step is denied. Nothing is approved by waiting.
- Typing into password or payment fields, submitting forms and navigating away are never allowed. While a Page Action runs, the page asks the browser to confirm before it unloads, which catches clicks that navigate unexpectedly.
- The Panel is never part of the page as the Assistant sees it. It is left out of the element list and cannot be clicked, so the Assistant cannot approve its own steps.
- Scrolling goes only to an element the Assistant already knows about, so it cannot search the page by scrolling. The Allow prompt for typing shows the exact text and the field.
- Only the main page is in reach. Frames embedded from other sites, where payment forms usually live, are left out of the element list; a Mark can still point at a frame as a whole.
- The Assistant points at elements by reference. Clicks always go through an element; only Marks may fall back to a rectangle of the visible page.
- "Act on the page" is off by default on the options page. "Draw on the page" is on by default.

## Considered Options

- **Drop `--no-chrome` and use Claude Code's own Chrome integration**: rejected. It needs the separate Claude in Chrome extension, controls the whole browser rather than this tab, and its steps would not appear in the Panel or pass through browser-click's approvals.
- **No tools: the Assistant writes Marks as markup in its answer**: rejected. It covers drawing only, and the Assistant never sees what a step did, so it cannot work in steps.
- **Screenshot coordinates only**: rejected for clicks. Coordinates break as soon as the page scrolls or reflows, and clicking by pixel is error-prone.
