---
type: llm
focus: last_message
---
Pass when the reply tells the user that a session was started, and names the session or its branch along with its status (such as working or blocked). A one-line reply like "Started `fix-backoff` on branch `fix-backoff`, and it's working." passes. Fail when the reply leaves out both the session and the branch.
