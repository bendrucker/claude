---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Implements an importance gate for bot code reviews plus an availability cooldown cache, after exhausting Greptile's free OSS review credits. A single gate keyed on diff size/surface decides both the local CLI and the hosted bot; hosted review becomes opt-in via a review label. Also fixes a sandboxed Node DNS issue (NODE_USE_ENV_PROXY=1) and grants ~/.greptile write access. 11 files changed, +296/-24.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
