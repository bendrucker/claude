---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body carries every point below, or all but one. A point counts in any wording and any form: a sentence, a list item, a table row, or a code block. Fail when two or more points are missing. Length, headings, and style do not matter here.

- The herdr CLI can't see sessions the Herdr app hosts in herdr-core
- The skill defers to the manuals hc and herdr-app print, which match the installed version
- No status hook is needed because Claude Code emits the OSC 7501 status herdr-core reads
- The sandbox grants the herdr-core state directory because XDG_RUNTIME_DIR is unset on macOS
- The HERDR_ENV call sites still target the TUI only and are no-ops under the app
