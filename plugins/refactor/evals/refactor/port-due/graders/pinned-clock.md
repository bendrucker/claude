---
type: llm
---
`bin/due` reads the current time, so its output depends on when it runs. When comparing the old and new versions, the session gave both the same "now", for example with an environment variable both honor, `faketime`, or a `date` stub on `PATH`, or it compared runs taken back to back and checked that day boundaries could not split them. Fail when the session checks parity only by eyeballing one run of each, or never runs the original.
