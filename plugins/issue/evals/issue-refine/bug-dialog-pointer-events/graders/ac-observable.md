---
type: llm
---
Read only the issue between the <issue> lines. The acceptance criteria or the test the issue asks for show the user-visible bug: after cancelling the delete dialog, the page still responds to clicks. A test whose only assertion is the CSS value of pointer-events on body, the intermediate cause, fails. For example, "A Playwright spec cancels the delete dialog from the viewer kebab, then clicks a document in the list and lands on it" passes. Mentioning pointer-events to explain the cause is fine.
