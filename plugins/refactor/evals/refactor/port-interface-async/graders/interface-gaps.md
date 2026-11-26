---
type: llm
---
The old `recent(id, 3)` returns the last three turns (a user message plus the tool and assistant messages after it, nine messages for `demo`), while agentkit's `load` limit counts messages. The old store returns an empty list for an unknown session, while `load` throws `SessionNotFound`. The existing files use `r`/`t` keys. The session keeps `buildPrompt` producing the same context it did before (the last three turns, an empty context for an unknown session) and reads the existing files, or it tells the user in the final reply which of these changed and asks for sign-off. Fail when the port passes `limit: 3` straight through so the prompt gets three messages, or lets an unknown session throw, and the reply does not name the difference.
