# Manual test checklist

The in-browser flow is checked by hand before a release. Unit tests (`npm test`) cover the Conversation (including the page tools and their rules on a test document), Selection geometry, Page Context extraction and the Claude Code relay; this list covers what they cannot: Chrome, real pages, layout, the native host and the real Anthropic API and Claude Code.

Work through it top to bottom. The first part runs on the API key backend; the second, from [Claude Code backend](#claude-code-backend), switches to Claude Code and ends with one end-to-end run on a real settings page.

## Setup

- Build with `npm run build` and load `.output/chrome-mv3` unpacked in `chrome://extensions` (Developer mode on). The card shows no errors.
- Have a working Anthropic API key and, for one check, a deliberately wrong one.
- For the second part, have Claude Code installed and signed in (`claude auth login`), on macOS or Linux.
- Test pages: a long article (for example a Wikipedia article), a page with a playing video (YouTube), a page that changes without reloading (YouTube: click another video), a `chrome://` page and a PDF opened in Chrome's viewer. The second part lists its own pages.

## Options page

- [ ] With no key saved, clicking the toolbar icon opens the options page and does not enter Selection Mode.
- [ ] The options page offers Claude Opus 5.5 (marked default), Claude Sonnet 5.5 and Claude Haiku 5.5, with Opus selected on a fresh install.
- [ ] Web search is on by default.
- [ ] On a fresh install, under **On the page**, "Draw on the page" is on and "Act on the page" is off, and both say they work with Claude Code only for now.
- [ ] Paste a key, change the model and toggle web search and both page switches, then **Save**: "Saved" appears. Reload the page: the values are still there.
- [ ] Quit and reopen Chrome: the settings are still there.
- [ ] **Show** and **Hide** toggle whether the key is visible.
- [ ] With a Panel open on a web page, open DevTools, choose **browser-click** in the console's context menu (the dropdown that says "top") and run `await chrome.storage.local.get()`. It fails with "Access to storage is not allowed from this context", so not even the injected page code can read the key.

## Toolbar click and Selection Mode

- [ ] On a `chrome://` page, the Chrome Web Store and a PDF in the built-in viewer, clicking the icon shows a short "browser-click can't run here" popup. The next click shows it again; nothing else happens.
- [ ] On an article, clicking the icon freezes the page: a still with a light shade and a hint at the top.
- [ ] On a playing video, the still shows the frame from the moment of the click while the video plays on underneath.
- [ ] The mouse wheel, trackpad, `Space`, `Page Down` and arrow keys do not scroll the page while selecting.
- [ ] Dragging shows the rectangle as it is drawn, in any direction, including up to the very edge of the window.
- [ ] A click or a drag of only a few pixels is ignored, and Selection Mode stays active.
- [ ] `Esc` leaves Selection Mode with no Selection and no Panel.

## Panel

- [ ] Releasing the drag opens the Panel next to the Selection, with a thumbnail that shows exactly the selected area and none of the overlay.
- [ ] The question box is focused: typing goes straight into it.
- [ ] The page's own styles don't leak into the Panel (check on a site with heavy styling).
- [ ] The Panel stays put while the page scrolls.
- [ ] Dragging the header moves the Panel. It cannot be dragged off screen, it doesn't shrink near the bottom edge, and it can't be resized.
- [ ] Making the window smaller keeps the Panel on screen.
- [ ] With the system set to dark mode the Panel is dark; in light mode it is light.
- [ ] On YouTube, typing `k`, `j` or `/` in the question box doesn't control the video.
- [ ] `Esc` while the Panel is focused closes it, and so does **×**.

## Asking

- [ ] Nothing is sent before asking: the Network panel of the extension's service worker (`chrome://extensions` → browser-click → **service worker**) shows no request to `api.anthropic.com` until you ask.
- [ ] Typing a question and pressing `Enter` sends it. A "Thinking" indicator appears until the first words arrive, then the answer streams in.
- [ ] **Explain this** sends a default question in one click.
- [ ] Answers are plain and brief, and Markdown renders: lists, bold, inline code and code blocks (also while still streaming).
- [ ] Links in answers open in a new tab.
- [ ] Selecting something unreadable (a few blurry pixels, half a word) makes Claude say the Selection is unreadable or ambiguous rather than guess.
- [ ] Claude's answer reflects the page it came from (ask "what is this article about, and where does this part fit?").
- [ ] On a very long page, the Panel notes that only the first 30,000 characters of the page text are sent.
- [ ] **Stop** while an answer streams stops it and keeps the text so far. A follow-up question then works.
- [ ] Try each model in options: each answers. The request's `model` in the service worker's Network panel matches the choice.
- [ ] With both page switches on, the API key backend still offers no page tools: no Marks appear, and the request has no `look`, `mark`, `scroll_to`, `click` or `type` tool.

## Follow-ups

- [ ] After an answer, a follow-up question is answered with the earlier turns in mind ("explain that more simply").
- [ ] Earlier questions and answers stay visible. The Panel scrolls to follow new answers, and stays where you are if you scroll up to reread.
- [ ] Prompt caching works: in the service worker's Network panel, the second request's response shows `cache_read_input_tokens` greater than 0 in its `message_start` usage.

## Adding a Selection

- [ ] **Add selection** hides the Panel and enters Selection Mode with a fresh still (the Panel is not in it).
- [ ] `Esc` returns to the Panel with the Conversation unchanged.
- [ ] A new Selection appears as a thumbnail labelled "Added to your next question" and is not sent on its own.
- [ ] Asking "how does this relate to the first one?" sends it, and the answer takes both Selections into account.
- [ ] On YouTube, move to another video without reloading, add a Selection and ask about it: the answer refers to the new video's page, and the Panel and Conversation survived the navigation.
- [ ] With a Panel open, follow a link to another site in the same tab, then press Back. Chrome restores the page from its back/forward cache with the Panel still open, but the tab access has lapsed: **Add selection** shows "lost access… click its toolbar icon". Clicking the icon then adds the Selection to the same Conversation. (If the page reloads instead, the Panel is gone; try another site.)

## Web search

- [ ] Ask about something recent or obscure that the page doesn't explain: "Searching the web…" shows while it searches, and sources are listed as links under the answer.
- [ ] With web search off in options (start a new Conversation after changing it), the same question gets no search, and the request has no `tools`.
- [ ] Try web search with each of the three models: none is rejected for the tool version.
- [ ] If your organization has web search disabled, the Panel says Anthropic rejected the web search tool and offers **Open options**.

## Errors

- [ ] With a wrong API key, the Panel says the key wasn't accepted, with **Retry** and **Open options**. After fixing the key, **Retry** answers the same question.
- [ ] With the network off (DevTools → Network → Offline on the service worker), the Panel says it couldn't reach Anthropic. Turn the network back on: **Retry** works.
- [ ] A rate limit (if you can trigger one) shows its own message with **Retry**.
- [ ] After any error, the Selection is offered again with the next question and the Conversation keeps working.
- [ ] If Claude declines a request, the Panel says so plainly with **Retry**, and no second request is made on another model.

## Starting over and ending

- [ ] Clicking the toolbar icon with a Panel open and making a Selection replaces the Conversation with a new one, without asking.
- [ ] Closing the Panel while an answer streams stops the request.
- [ ] Reloading the page removes the Panel; nothing of the Conversation is kept.

## Claude Code backend

Switch to **Answer with: Claude Code**, register the helper with `npm run install-host -- --extension-id <ID>`, reload browser-click, click **Check Claude Code** and **Save**. Settings changes apply from the next Conversation, so start a new one (toolbar icon, new Selection) after each change. To see what the helper started `claude` with, run `ps -ww -o args= -p $(pgrep -f 'claude -p')` while a Panel is open.

Pages used below:

- A settings page with toggles, buttons and fields, where you are signed in (GitHub's settings: `github.com/settings/profile` and `github.com/settings/notifications`)
- A long page with headings far below the fold (a long Wikipedia article)
- A page with a chart (a stock price chart) and a page with an embedded video from another site (a blog post with a YouTube embed)
- A docs site with a search box, preferably a React one whose search is a controlled field (react.dev)
- A sign-in page with a password field, a checkout page with a card number field, and a page with a card form in a cross-origin iframe (a Stripe checkout demo)
- A page with a newsletter or sign-up form
- A local test page that navigates by script: save `<button onclick="setTimeout(() => location.href='https://example.org', 50)">Continue</button>` as `leave.html`, serve its folder with `python3 -m http.server` and open `http://localhost:8000/leave.html`

### The helper and the page switches

- [ ] With "Draw on the page" on and "Act on the page" off, `claude`'s arguments include `--mcp-config` and `--strict-mcp-config`, and `--allowedTools` lists `mcp__browser-click__look` and `mcp__browser-click__mark` only (plus `WebSearch` when web search is on). `--setting-sources ''`, `--no-chrome` and `--disable-slash-commands` are all there.
- [ ] With both on, `--allowedTools` also lists `scroll_to`, `click` and `type`.
- [ ] With both off, there is no `--mcp-config` and no page tool in `--allowedTools`, and browser-click answers exactly as it did before: no Marks and no lines for them in the answer.
- [ ] With "Act on the page" off, Claude never offers to scroll, click or type, and the page never moves.
- [ ] Your own MCP servers, hooks and CLAUDE.md files (add a harmless one to `~/.claude` to check) play no part: Claude doesn't mention or use them.

### Marks ("Draw on the page" on)

- [ ] On GitHub's notification settings, ask "where do I turn off email notifications?": a box appears around the right toggle, not offset from it, and the answer shows "Marked *…*".
- [ ] Ask for the steps to do something ("show me, step by step, how to save this"): numbered labels 1, 2, 3 sit on the top-left corners of the right elements, and the answer shows one "Labelled *…* N" line per label.
- [ ] Ask it to point with an arrow and to highlight a heading: the arrow sits just left of its target (or just right of it when the target is at the window's left edge) and points at it; the highlight covers the heading without hiding its text.
- [ ] On the chart, select the chart and ask "where is the biggest spike?": a Mark lands on the spike itself, and the answer line says "an area of the page".
- [ ] On the page with an embed, ask "which video is this about?": a Mark surrounds the whole embedded video. The Assistant mentions nothing from inside the video player.
- [ ] Clicks, hovers and text selection all reach the page through the Marks.
- [ ] Scroll the page slowly, then fast, with the mouse wheel and with the scrollbar: element Marks stay on their elements and area Marks move with the page. Scroll inside a scrollable box on the page that holds a marked element: its Mark follows.
- [ ] Resize the window so the page reflows: element Marks follow their elements.
- [ ] Draw a Mark under the Panel (drag the Panel over the marked element first, then ask again): the Panel moves aside so the target is visible, stays fully inside the window, and keeps its size. In a small window where it can't clear the target, it stays inside the window covering as little of it as it can.
- [ ] With Marks on the page, click **Add selection**: the Marks disappear before the still is taken (they are not in the new Selection's thumbnail) and stay hidden while selecting. After finishing the Selection, and separately after cancelling with `Esc`, the Marks come back where they were.
- [ ] Ask the next question: the previous answer's Marks disappear. Close the Panel: every Mark disappears.

### Looking at the page as an image

- [ ] On the chart page, ask what it shows: the Assistant calls *look* with an image and describes the chart. On a text-only question it calls *look* without one.
- [ ] With a Mark on the page, ask a question that needs an image: the Mark is not in the image (it may blink off for a moment) and is back afterwards.
- [ ] On a large, high-DPI window the image still reaches the Assistant (it is shrunk below the 1 MB native message cap); the answer doesn't hang.
- [ ] Start Selection Mode while an answer is running: a *look* image asked for meanwhile is refused with a reason, and the answer carries on.

### Scrolling ("Act on the page" on)

- [ ] On the long article, select the top and ask where it talks about something in a section far below. The page scrolls to it without asking, and the answer shows "Scrolled to *…*".
- [ ] Asking for something that isn't on the page doesn't move the page; if Claude tried, the answer shows "Didn't scroll to *…*".

### Clicking

- [ ] On a page with a button in view that opens a menu (on `github.com/settings/profile`, the **Edit** button on your profile picture), ask Claude to open it. The answer shows an Allow / Deny prompt naming the button ("Click the button *Edit*?"), and nothing is clicked until **Allow**.
- [ ] After **Allow**, the button is clicked, the answer shows "Clicked *…*", and Claude can carry on from what appeared (for example, point at an item in the opened menu).
- [ ] After **Deny**, nothing is clicked, the answer shows "Didn't click *…*" and Claude carries on without it.
- [ ] With the prompt showing, typing a new question and pressing `Enter` denies the click, stops that answer and answers the new question.
- [ ] With the prompt showing, **Stop** denies the click and stops the answer. Leaving the prompt alone never clicks.
- [ ] With the prompt showing, closing the Panel ends Claude Code cleanly (no stuck `claude` process in Activity Monitor).
- [ ] An in-page link (`#section`) and a link in a single-page app (for example GitHub's repository tabs) are clicked after **Allow**.
- [ ] A link's Allow prompt says that browser-click cancels it if it would load another page. On a plain multi-page site, ask Claude to open another page of the same site and **Allow**: the page stays, and the answer shows "Didn't click *…*".
- [ ] With the Allow prompt showing, click into the question box and type: the keystrokes go into the box, and none of them (`Enter` and `Space` included) allows the step.

### Typing

- [ ] On the docs site, ask "search this site for refunds". The Allow / Deny prompt shows the exact text and names the field ("Type `refunds` into the searchbox *Search*?"), and nothing is typed until **Allow**.
- [ ] After **Allow**, the text appears in the field and the page reacts to it (results filter or suggestions appear, as when you type yourself), and the answer shows "Typed *refunds* into *Search*". Nothing presses Enter or submits the search.
- [ ] Ask for text with double spaces, quotes and a long word: the prompt shows it exactly, wrapped, not shortened, and the field ends up holding exactly that.
- [ ] After **Deny**, the field is unchanged and the answer shows "Didn't type *…* into *…*".
- [ ] Ask Claude to change what it typed ("search for returns instead"): a new prompt appears for the new text.

### Never allowed

Each of these is refused without an Allow / Deny prompt, and the answer shows the "Didn't …" line.

- [ ] Ask Claude to press a form's submit button ("sign me up" on the newsletter form): nothing is sent, "Didn't click *…*".
- [ ] Ask Claude to follow a link to another site, or one that opens a new tab: the page stays, "Didn't click *…*".
- [ ] On a page with a cross-origin iframe (the YouTube embed or the Stripe demo), Claude can't click or type inside the frame: "Didn't click *…*" or "Didn't type *…*".
- [ ] On the sign-in page, ask Claude to fill in the password, and on the checkout page the card number: nothing is typed, "Didn't type *…* into *…*", and Claude says you must type it yourself.
- [ ] Ask Claude to click **Allow** for you, or anything else in the Panel: it can't (the Panel isn't among the elements it sees).
- [ ] On `leave.html`, ask Claude to click Continue and **Allow**. Chrome shows its "Leave site?" dialog; **Cancel** keeps the page and the Panel. Clicking the same button yourself a few seconds afterwards navigates with no dialog. (Chrome shows the dialog only after a real click in the page; the **Allow** click counts.)

### End-to-end run on a real settings page

One Conversation on `github.com/settings/profile`, signed in, with Claude Code, both page switches on and the window small enough that the bottom of the form is out of view. Afterwards every line in the answer matches what happened to the page, and nothing on your profile changed.

- [ ] **Mark**: select the page header and ask "where do I change my profile picture?". A box appears around the picture or its **Edit** button, and the answer shows "Marked *…*".
- [ ] **Scroll**: ask "where do I choose whether my profile shows private contributions?" (or another setting far below). The page scrolls without asking, the answer shows "Scrolled to *…*", and the previous answer's Mark is gone.
- [ ] **Allowed click**: scroll back up and ask "open the menu for my profile picture". **Allow** the click: the menu opens, the answer shows "Clicked *Edit*", and Claude points at the menu's items.
- [ ] **Denied click**: ask "remove my profile picture". When the prompt for *Remove photo* (or similar) appears, click **Deny**. Nothing happens, the answer shows "Didn't click *…*", and Claude carries on, telling you how to do it yourself.
- [ ] **Typed text**: ask "put `Testing browser-click` in my bio". The prompt shows exactly that text and names the Bio field. **Allow**: the text is in the field and the answer shows "Typed *Testing browser-click* into *Bio*".
- [ ] **Refused submit**: ask "now save my profile". No prompt appears, nothing is submitted, the answer shows "Didn't click *Update profile*" (or the button's name) and Claude says you must save it yourself.
- [ ] Close the Panel: every Mark disappears and `claude` exits. Reload the page (accept Chrome's warning about unsaved changes if it asks): the bio is unchanged, the picture is still there, and the Conversation is in `~/browser-click-threads` for `claude --resume`.
