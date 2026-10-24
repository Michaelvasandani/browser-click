# browser-click

Ask Claude about the part of a page that confuses you, without leaving the page.

Click the toolbar icon, drag a rectangle over a paragraph, diagram, equation, chart or video frame, and a small Panel opens next to it. Ask your question (or click **Explain this**) and Claude answers in place. It already knows which page you are on and what the surrounding text says. Ask follow-ups, or bring another part of the page into the same Conversation with **Add selection**.

browser-click is a Chrome extension that talks straight to the Anthropic API with your own API key, or answers through your own [Claude Code](https://claude.com/claude-code) so you don't need a key. It has no backend and no telemetry. Terms such as Selection, Page Context and Panel are defined in [GLOSSARY.md](GLOSSARY.md).

## Install from source

browser-click is not on the Chrome Web Store. You build it yourself and load it unpacked.

You need [Node.js](https://nodejs.org/) 22.12 or later and Google Chrome.

```sh
git clone https://github.com/Michaelvasandani/browser-click.git
cd browser-click
npm install
npm run build
```

Then, in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `.output/chrome-mv3` folder inside the repo.
4. Optionally, pin browser-click from the puzzle-piece menu so its icon stays in the toolbar.

To update, pull the latest code, run `npm run build` again and click the reload icon on browser-click's card in `chrome://extensions`.

## Set up your API key

browser-click uses your own Anthropic account and you pay for what you use.

1. Sign in to the [Anthropic Console](https://console.anthropic.com/) and create an API key under **Settings → API keys**. Add credits under **Billing** if your account has none.
2. Click the browser-click toolbar icon. With no key saved, it opens the options page. You can also get there from **Details → Extension options** in `chrome://extensions`.
3. Paste the key and click **Save**.

The options page also has:

- **Model**: Claude Opus 5.5 (the default, best answers), Claude Sonnet 5.5 (faster and cheaper) or Claude Haiku 5.5 (fastest and cheapest).
- **Web search**: on by default. Turn it off to cap cost and latency.

Settings are kept in Chrome's local extension storage on this computer. They are not synced, and the code browser-click injects into web pages cannot read them.

## Or use Claude Code instead of an API key

If you have Claude Code, browser-click can answer through it. Answers then count against your Claude Code usage, and each Conversation is saved as a Claude Code session you can pick up later. This works on macOS and Linux.

1. Install Claude Code and sign in with `claude auth login`.
2. On browser-click's options page, choose **Answer with: Claude Code**. The page shows your extension ID.
3. In the browser-click folder, register the local helper (a [native messaging host](native-host/host.mjs)) for that ID:

   ```sh
   npm run install-host -- --extension-id <your extension ID>
   ```

4. Reload browser-click in `chrome://extensions`, click **Check Claude Code** on the options page, then **Save**.

Each open Panel runs one `claude` process. It starts as soon as you make a Selection, so it is usually ready by the time you have typed your question, and follow-ups reuse it. The process ends when you close the Panel. Conversations are saved in `~/browser-click-threads` (pass `--threads-dir` to choose another folder). To pick one up in Claude Code, run `claude --resume` in that folder.

The helper runs Claude Code with browser-click's own instructions, with web search as its only tool (none when web search is off), and without your Claude Code settings, hooks, CLAUDE.md files or MCP servers. Web search uses Claude Code's own search, so answers on this backend don't list source links.

## Using it

- **Start**: click the toolbar icon. The visible page freezes as a still, so a playing video stays on the frame you reacted to. Drag over the part you want to ask about. `Esc` cancels.
- **Ask**: type a question and press `Enter` (`Shift+Enter` for a new line), or click **Explain this**. Nothing is sent until you do.
- **Follow up**: keep asking in the same Panel. Claude remembers the Conversation.
- **Add selection**: select another part of the page (the Panel hides while you do). The new Selection goes with your next question.
- **Stop**: stops an answer that is going the wrong way. The text so far stays.
- **Move or close**: drag the Panel by its header. Close it with **×** or `Esc`.
- **Start over**: click the toolbar icon again while a Panel is open. A new Selection replaces the current Conversation. Press `Esc` instead of selecting to keep the old one.

## What leaves your machine

When you ask a question, browser-click sends a request **directly from your browser to Anthropic's API** (`api.anthropic.com`), authenticated with your API key. The request contains:

- **Your Selections**: the image of each rectangle you drew, cropped from the screenshot taken when you started selecting.
- **The Page Context of each Selection**: the page's title, URL and main text (up to about 30,000 characters), read when the Selection was made. Only the top-level page is read, not embedded frames.
- **Your questions**, and the earlier questions and answers of the same Conversation, so Claude can follow it.

When web search is on, Claude may also send search queries it writes itself. Anthropic runs those searches.

With the Claude Code backend, the same request goes to the local helper instead, which hands it to `claude` on your machine. Claude Code sends it to Anthropic under your Claude Code account and saves the Conversation in its session files.

Nothing is sent before you ask a question or click **Explain this**. Nothing goes anywhere else: there is no browser-click server, no analytics and no telemetry. With the API key backend, Conversations are kept only in the open page's memory and are discarded when you close the Panel or reload the page, and only your settings are saved.

What Anthropic does with API requests is governed by your agreement with Anthropic and its [privacy policy](https://www.anthropic.com/legal/privacy). Don't use browser-click on pages whose content you would not want to send to Anthropic.

### Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Access to a tab only after you click the toolbar icon, and only until that tab navigates away. browser-click cannot read your other tabs. |
| `scripting` | Injects the selection overlay and Panel into the page when you click the icon. There are no always-on content scripts. |
| `storage` | Saves your settings locally. |
| `nativeMessaging` | Talks to the local Claude Code helper, if you installed it. |
| `https://api.anthropic.com/*` | The only site browser-click talks to. |

## Known limits

- **Visible area only.** A Selection can only cover what is on screen. Scrolling is locked while you select.
- **DRM-protected video captures as black.** Netflix, Disney+ and similar players block screenshots, so their frames come out black.
- **Some pages are off limits.** Chrome doesn't let extensions run on `chrome://` pages, the Chrome Web Store or the built-in PDF viewer. browser-click says so when you click its icon there.
- **Access lapses on navigation.** If the tab navigates to another page while a Panel is open, **Add selection** asks you to click the toolbar icon again.
- **Web search costs extra.** Anthropic bills each search ($10 per 1,000 searches at the time of writing) on top of token costs, with at most 3 searches per answer. Your organization's admin may also need to enable web search in the Anthropic Console. If the API rejects it, the Panel says so. You can turn it off in the options.
- **Math is not rendered.** Claude is asked to write math in plain text or Unicode.

## Development

```sh
npm run dev       # build in watch mode and open a Chrome window with the extension loaded
npm test          # unit tests (Vitest)
npm run compile   # type-check
npm run build     # production build in .output/chrome-mv3
```

The code lives in `src/`:

| Path | What it is |
| --- | --- |
| `entrypoints/background.ts` | Background service worker: reacts to the toolbar click, captures the visible tab and relays model calls (`background/model-relay.ts`). It holds the API key and keeps no Conversation state. |
| `entrypoints/page.ts` | Page code, injected on toolbar click. `page/controller.ts` wires Selection Mode (`page/overlay.ts`) to the Panel (`page/panel-host.tsx`, `page/panel/`). |
| `entrypoints/options/` | The options page. |
| `lib/conversation.ts` | The Conversation: builds each request, consumes the streamed response and emits the events the Panel renders. Its model client is passed in. |
| `lib/geometry.ts` | Turns a drawn rectangle into the crop of the captured image. |
| `lib/page-context.ts` | Extracts title, URL and readable text from the page. |

Unit tests sit next to the modules they cover (`*.test.ts`). The in-browser flow is checked by hand with [docs/manual-test-checklist.md](docs/manual-test-checklist.md).

## License

[MIT](LICENSE)
