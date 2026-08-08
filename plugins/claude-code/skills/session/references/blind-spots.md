# Known Blind Spots

Full elaboration of the structural absences summarized in [`SKILL.md`](../SKILL.md) "Known Blind Spots". The `index-health` query detects drift the corpus can show. These six are absences no query can surface, because nothing was ever indexed for them.

## Thinking Text

Claude Code persists thinking blocks as signature-only stubs. `content_items` rows with `type = 'thinking'` exist but carry no text. Reasoning is unsearchable from transcripts and must be intercepted at runtime (hooks) if needed.

## Retention Floor

`cleanupPeriodDays` deletes old session files, and the index rebuilds from surviving JSONL on migration, so the corpus floor ratchets forward (see `corpus-window`). `~/.claude/history.jsonl` holds prompt-level history much further back but is not ingested.

## Cloud and Mobile Sessions

claude.ai web/mobile chats and cloud routines write no local JSONL. A `bridge-session` record marks only that a cloud bridge existed. The cloud side's content stays remote.

## Approved Permission Prompts

Only rejections leave a trace (`"User rejected tool use"` results). A prompt the user approved is indistinguishable from a call that never prompted, so prompting friction is undercountable.

## Offloaded Tool Results

Large outputs are truncated to a `<persisted-output>` preview pointing at a sidecar file under `tool-results/`. The full output never enters the index.

## Other Machines

Only imported hosts exist. A machine never imported, or one gone stale (see `host-staleness`), is invisible rather than empty.
