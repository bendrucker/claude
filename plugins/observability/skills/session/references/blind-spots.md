# Known Blind Spots

Full elaboration of the structural absences summarized in [`SKILL.md`](../SKILL.md) "Known Blind Spots". The `index-health` query detects drift the corpus can show. The six below are absences no query can surface, because nothing was ever indexed for them. `field-drift` covers the opposite case, a field the harness added that no query reads yet.

## Thinking Text

Claude Code persists thinking blocks as signature-only stubs. `content_items` rows with `type = 'thinking'` exist but carry no text. Reasoning is unsearchable from transcripts and must be intercepted at runtime (hooks) if needed. The volume is measurable even though the text is not: `$.message.usage.output_tokens_details.thinking_tokens` counts it, roughly 45% of output tokens since 2026-08-11.

## Retention Floor

`cleanupPeriodDays` deletes old session files and the index reaps their rows on the next refresh, so the corpus floor ratchets forward (see `corpus-window`). `~/.claude/history.jsonl` holds prompt-level history much further back but is not ingested.

## Cloud and Mobile Sessions

claude.ai web/mobile chats and cloud routines write no local JSONL. A `bridge-session` record marks only that a cloud bridge existed. The cloud side's content stays remote.

## Approved Permission Prompts

Only denials leave a trace. `$.toolDenialKind` names which mechanism stopped a call (see `permission_requests`), so the denial side is fully classified, but a prompt the user approved is indistinguishable from a call that never prompted. Prompting friction stays undercountable.

## Offloaded Tool Results

Large outputs are truncated to a `<persisted-output>` preview pointing at a sidecar file under `tool-results/`. The full output never enters the index, but it is recoverable rather than gone: `$.toolUseResult.persistedOutputPath` records the sidecar's path (838 rows, 351MB), and spot-checks found the files still on disk. Read one directly when an analysis turns on what a truncated result actually said.

## Other Machines

Only imported hosts exist. A machine never imported, or one gone stale (see `host-staleness`), is invisible rather than empty.

## Fields With No Signal

Present in the corpus, checked, and carrying nothing. `field-drift` will keep surfacing new fields, so record here anything that turns out to be constant. It saves the next pass the check.

- `message.stop_details`: always null.
- `message.usage.inference_geo`: `not_available` on 113,341 of 113,387 rows.
- `service_tier` and `speed`: constant `standard`.
- `toolUseResult.userModified`: false on all 39,363 rows.
- `mode`: always `normal`.
- `atis-latch.atis`: empty string.
- `classifierMetaLines`: carries `repoVisibility` and nothing else.
