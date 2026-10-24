# Offer Claude Code as a second backend, through a native messaging host

Supersedes [0001](0001-anthropic-sdk-only.md) in part: the Anthropic SDK stays the default backend, but it is no longer the only way browser-click reaches Claude.

Requiring an Anthropic API key turned out to be the biggest obstacle to using browser-click: most people who would use it already pay for Claude through a subscription and use it in Claude Code. We decided to let browser-click answer through the user's own Claude Code instead. The extension talks to a small local program (a Chrome native messaging host) that runs `claude -p` in streaming JSON mode, one long-lived `claude` process per Conversation. Answers then count against the user's Claude Code usage, and each Conversation is saved as a Claude Code session that can be resumed later with `claude --resume`.

The page code and the Conversation are unchanged: the Background turns Claude Code's output back into the stream events and final message the Conversation already consumes. The API key backend stays, and stays the default, because it needs no local install.

## Consequences

- Setup is longer: Claude Code must be installed and signed in, and the user runs a one-time install script that registers the host with Chrome for this extension's ID. Only macOS and Linux are supported for now.
- The extension gains the `nativeMessaging` permission, and on this backend requests no longer go from the browser straight to `api.anthropic.com`.
- The first answer of a Conversation waits for `claude` to start. The process is started when the Panel opens, so most of that happens while the user types; follow-ups reuse it.
- Claude Code is a coding agent. The host runs it with browser-click's own system prompt, no tools other than web search (and only when web search is on), no user or project settings (so no hooks, CLAUDE.md or MCP servers) and in a folder of its own, so a page cannot steer it into the user's files.
- Web search is Claude Code's own WebSearch tool, not the API's server-side tool, so answers on this backend show no source links.

## Considered Options

- **Make browser-click an MCP server for Claude Code**: rejected. Claude Code would call browser-click, not the other way round, so answers would appear in Claude Code rather than in the Panel next to the Selection.
- **Reuse Claude Code's subscription OAuth token from the extension**: rejected. Third-party apps may not use claude.ai logins without Anthropic's approval, and the token flow is undocumented.
- **Start a fresh `claude -p` for every question**: rejected. Each answer would pay the start-up cost and resume the session from disk.
