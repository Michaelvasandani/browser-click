# Glossary

The words below have a specific meaning in browser-click's code, issues and docs.

**Selection**
: A rectangle the user drew over the visible page, captured as an image, together with the Page Context of the page it was drawn on. A Selection is attached to the next question the user asks.
_Avoid_: Screenshot, highlight, snippet, capture

**Selection Mode**
: The state entered by clicking the toolbar icon (or **Add selection**): the visible page is frozen as a still, scrolling is locked and the user drags a rectangle on the still. `Esc` leaves it without making a Selection.
_Avoid_: Capture mode, crosshair mode

**Page Context**
: What the Assistant is told about the page a Selection came from: its title, URL and readable text (capped at about 30,000 characters, with a flag saying whether it was cut off). It is captured per Selection, at the moment the Selection is made.
_Avoid_: Metadata, page data

**Assistant**
: The Claude model that answers, reached through a Backend. Besides answering, it may draw on the page and act on it when that helps with what the user asked, but only within the part of the page currently in view. The user can turn this off.
_Avoid_: Agent, bot, AI

**Mark**
: Something the Assistant draws over the page to show the user where something is: a box, arrow, highlight or numbered label. A Mark changes nothing on the page itself. It points at an element of the page, or at a rectangle of the visible page when there is no element to point at. A Mark belongs to the answer that drew it and is cleared when the user asks the next question or closes the Panel.
_Avoid_: Annotation, overlay, highlight

**Page Action**
: Something the Assistant does to the page: scrolling to a part of the page it already knows about from the Page Context, clicking, or typing. Clicking and typing happen only after the user allows them in the Panel, and the user sees the exact text before it is typed; typing into password or payment fields, submitting forms, leaving the page and reaching inside content embedded from other sites are never allowed.
_Avoid_: Action, command, interaction

**Conversation**
: One thread of questions, answers and Selections in a Panel. It lives only in the open page and is discarded when the Panel closes or the page reloads; on the Claude Code backend, Claude Code also saves it as a session.
_Avoid_: Chat, thread, session, history

**Backend**
: How browser-click reaches the Assistant: the Anthropic API with the user's own key (the default), or the user's own Claude Code, through a local native messaging host that runs one `claude` process per Conversation.

**Panel**
: The small window browser-click opens on the page, next to the first Selection. It shows the Selections, the question box and the Assistant's answers.
_Avoid_: Popup, chat window, sidebar, widget
