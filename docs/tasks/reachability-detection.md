# Reachability detection

Decide whether a human can answer interactively right now, so the gate knows whether `AskUserQuestion` is safe or it must take the durable fallback.

#### Context

Spec: [Blocking gate transport](../blocking-dispatch.md#blocking-gate-transport) and [Resolved mechanics](../blocking-dispatch.md#resolved-mechanics). `AskUserQuestion` returns empty answers with no TTY, so a headless gate would proceed on nothing.

#### Depends on

- `dispatch-skill-scaffold.md`

#### Scope

A reliable test that classifies the current session as interactive or headless:

- Interactive: an attached terminal, or a web or mobile remote-control session where push lands and the user can respond.
- Headless: a `-p` run, a scheduled or `/loop` trigger, or a subagent context where `AskUserQuestion` silently auto-completes.

Return a single boolean the gate consumes.

#### Out of scope

The gate interaction itself. This task only answers can-a-human-respond-now.

#### Approach

No documented flag marks headless directly, so combine signals and fail safe. Treat the session as interactive when `CLAUDE_CODE_REMOTE` is `true` (web or mobile remote control), or when stdin and stdout are both a TTY (`[ -t 0 ] && [ -t 1 ]`, a local interactive terminal). Otherwise treat it as headless: a `-p` run, a scheduled or `/loop` trigger, or a subagent. Subagents and skills never call `AskUserQuestion` regardless. This matches the known empty-answer behavior in headless, Skill, and SDK contexts (claude-code [#29547](https://github.com/anthropics/claude-code/issues/29547), [#29733](https://github.com/anthropics/claude-code/issues/29733)).

#### Acceptance criteria

- [ ] The detector returns interactive in a normal terminal and remote-control session.
- [ ] The detector returns headless under `-p`, scheduled runs, and subagents.
- [ ] When the signal is ambiguous, it returns headless so the gate takes the durable fallback.

#### References

- [blocking-dispatch.md, resolved mechanics](../blocking-dispatch.md#resolved-mechanics)
- claude-code empty-answer issues [#29547](https://github.com/anthropics/claude-code/issues/29547), [#29733](https://github.com/anthropics/claude-code/issues/29733)
