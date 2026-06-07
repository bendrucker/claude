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
- The dedup check: before filing, scan the target lane (Things tag, GitHub search, Linear query) for an existing marker and suppress a match.

#### Out of scope

The per-lane filing itself. This task defines the shared marker contract the lanes consume.

#### Approach

Read the `improve-claude-code` fingerprint and dedup sections and reuse them verbatim where possible, rather than inventing a parallel scheme. Document the marker format once in the dispatch skill and have each lane reference it. Confirm the `claude-code:session` skill can resolve a `Session:` uuid filed from a remote session.

#### Acceptance criteria

- [ ] The marker format is documented once and referenced by every lane.
- [ ] Fingerprint computation matches `improve-claude-code` so the two lanes share dedup identity.
- [ ] The dedup check is specified for each target (Things, GitHub, Linear).

#### References

- `user/skills/improve-claude-code/SKILL.md`, Fingerprint and Dedup sections
- `claude-code:session`
