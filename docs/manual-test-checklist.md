# Manual test checklist

The in-browser flow is checked by hand before a release. Unit tests (`npm test`) cover the Conversation, Selection geometry and Page Context extraction; this list covers what they cannot: Chrome, the page and the real Anthropic API.

## Setup

- Build with `npm run build` and load `.output/chrome-mv3` unpacked in `chrome://extensions` (Developer mode on). The card shows no errors.
- Have a working Anthropic API key and, for one check, a deliberately wrong one.
- Test pages: a long article (for example a Wikipedia article), a page with a playing video (YouTube), a page that changes without reloading (YouTube: click another video), a `chrome://` page and a PDF opened in Chrome's viewer.

## Options page

- [ ] With no key saved, clicking the toolbar icon opens the options page and does not enter Selection Mode.
- [ ] The options page offers Claude Opus 5.5 (marked default), Claude Sonnet 5.5 and Claude Haiku 5.5, with Opus selected on a fresh install.
- [ ] Web search is on by default.
- [ ] Paste a key, change the model and toggle web search, then **Save**: "Saved" appears. Reload the page: the values are still there.
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

## Marks (Claude Code backend, "Draw on the page" on)

Use a settings page with toggles and buttons (for example GitHub's notification settings), a page with a chart (a stock price chart) and a page with an embedded video from another site (a blog post with a YouTube embed).

- [ ] Ask "where do I turn off email notifications?": a box appears around the right toggle, not offset from it, and the answer shows "Marked *…*".
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

## Looking at the page as an image (Claude Code)

- [ ] On a page with a chart or canvas, ask what it shows: the Assistant calls *look* with an image and describes the chart. On a text-only question it calls *look* without one.
- [ ] With a Mark on the page, ask a question that needs an image: the Mark is not in the image (it may blink off for a moment) and is back afterwards.
- [ ] On a large, high-DPI window the image still reaches the Assistant (it is shrunk below the 1 MB native message cap); the answer doesn't hang.
- [ ] Start Selection Mode while an answer is running: a *look* image asked for meanwhile is refused with a reason, and the answer carries on.

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

## Scrolling to things (Claude Code, "Act on the page" on)

- [ ] On a fresh install "Act on the page" is off on the options page; turning it on and saving sticks.
- [ ] On a long settings page, select the top and ask where to change something far below. The page scrolls to it without asking, and the answer shows "Scrolled to *Billing*" (or similar).
- [ ] Asking for something that isn't on the page doesn't move the page; if Claude tried, the answer shows "Didn't scroll to *…*".
- [ ] With "Act on the page" off, the page never scrolls and no scroll lines appear.
