# Glossary

The words below have a specific meaning in browser-click's code, issues and docs.

**Selection**
: A rectangle the user drew over the visible page, captured as an image, together with the Page Context of the page it was drawn on. A Selection is attached to the next question the user asks.

**Selection Mode**
: The state entered by clicking the toolbar icon (or **Add selection**): the visible page is frozen as a still, scrolling is locked and the user drags a rectangle on the still. `Esc` leaves it without making a Selection.

**Page Context**
: What the Assistant is told about the page a Selection came from: its title, URL and readable text (capped at about 30,000 characters, with a flag saying whether it was cut off). It is captured per Selection, at the moment the Selection is made.

**Assistant**
: The Claude model that answers, called through the Anthropic API with the user's own key.

**Conversation**
: One thread of questions, answers and Selections in a Panel. It lives only in the open page and is discarded when the Panel closes or the page reloads.

**Panel**
: The small window browser-click opens on the page, next to the first Selection. It shows the Selections, the question box and the Assistant's answers.
