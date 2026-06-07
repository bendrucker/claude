# Markers and dedup

Reuse the existing marker conventions so dispatched items trace back to their session and the same finding does not get filed twice.

#### Context

Spec: [Traceback and dedup](../blocking-dispatch.md#traceback-and-dedup) and [Relationship to existing lanes](../blocking-dispatch.md#relationship-to-existing-lanes). Dispatch generalizes the capture pattern that `improve-claude-code` and `agent-ideas` already use.

#### Depends on

- `dispatch-skill-scaffold.md`

#### Scope

Define how every dispatch lane stamps and deduplicates:

- `Session: <uuid>` in the notes or issue body, so `claude-code:session` can reconstruct the originating context.
- A fingerprint marker for findings that could recur, matching the `improve-claude-code` scheme (`sha256(finding_type + '|' + normalized_target)` truncated to 12 chars).
- The dedup check: before filing, scan the target lane for an existing marker and suppress a match. Scan Things through `things:jxa` (the way `improve-claude-code` reads its backlog), GitHub through `gh api` or issue search, and Linear through a `linear api` query.

#### Out of scope

The per-lane filing itself. This task defines the shared marker contract the lanes consume.

#### Approach

Reuse the `improve-claude-code` fingerprint verbatim: `sha256(finding_type + '|' + normalized_target)` truncated to 12 chars, where `normalized_target` is the config object, never a count or date. Document the marker format once in the dispatch skill and have each lane reference it. Confirm the `claude-code:session` skill can resolve a `Session:` uuid filed from a remote session.

#### Acceptance criteria

- [ ] The marker format is documented once and referenced by every lane.
- [ ] Fingerprint computation matches `improve-claude-code` so the two lanes share dedup identity.
- [ ] The dedup check is specified for each target (Things, GitHub, Linear).

#### References

- `user/skills/improve-claude-code/SKILL.md`, Fingerprint and Dedup sections
- `claude-code:session`
