---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body says agent status needs no hook because Claude Code already emits the OSC 7501 status that herdr-core reads. Any wording passes, such as "status works without a hook since 2.1.314 emits OSC 7501". Fail when the body omits why no status hook exists.
