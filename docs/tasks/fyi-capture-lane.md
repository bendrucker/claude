# FYI capture lane

Route a non-blocking FYI finding to the Things inbox, tagged by domain.

#### Context

Spec: [Non-blocking lanes](../blocking-dispatch.md#non-blocking-lanes) and [Where dispatches land](../blocking-dispatch.md#where-dispatches-land). Things is the FYI sink because it has no dependency primitive, which is fine for a leaf.

#### Depends on

- `dispatch-skill-scaffold.md`
- `markers-and-dedup.md`

#### Scope

The capture path for a finding that is non-blocking and not a ready fix:

- Call `things:inbox` with a concise title and self-sufficient notes.
- Tag `claude-code` when the finding is about Claude configuration, so `improve-claude-code` drains it. Tag plain `Claude` otherwise.
- Stamp the `Session: <uuid>` marker and run the dedup check.

#### Out of scope

The classification that decides a finding is FYI rather than a fix or a block. That lives in the scaffold's decision tree.

#### Approach

Reuse `things:inbox` exactly as `agent-ideas` does, including `--tag` and `--session-id`. Decide the domain tag from whether the finding targets the Claude config repo. Keep notes self-sufficient, since a capture is read later out of context.

#### Acceptance criteria

- [ ] A non-blocking FYI lands in the Things inbox with the right domain tag.
- [ ] The `Session:` marker is present and dedup suppresses a repeat.
- [ ] Config findings surface in the `improve-claude-code` backlog unchanged.

#### References

- `plugins/things/skills/inbox/SKILL.md`
- `.claude/skills/agent-ideas/SKILL.md`, Capture Keepers
