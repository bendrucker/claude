# Skill Patterns

## Dynamic Context Injection

The bang-backtick syntax runs shell commands as preprocessing before Claude sees the skill content. The output replaces the placeholder inline, so Claude receives rendered data and never sees the command.

```markdown
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -5`
```

### When to Use

Prefer bang-backtick over asking Claude to run the same command with Bash when:

- The data is **always needed** — every invocation requires it, so there's no decision for Claude to make
- The data **shapes the task** — Claude needs the output to understand what to do, not just as supplementary info
- **Latency matters** — preprocessing runs before the model prompt, avoiding a round-trip

Keep using `allowed-tools` with Bash for commands Claude should decide whether/when to run.

### Combining with Other Features

- `$ARGUMENTS` is substituted separately from bang-backtick expressions. Both can appear in the same skill.
- `context: fork` — commands run in the current working directory before the subagent starts. The subagent receives the rendered output.
- Supporting files — commands only run in `SKILL.md` content, not in referenced files.

### Gotchas

- Commands run in the **project root**, not the skill directory. For plugin skills, use `${CLAUDE_PLUGIN_ROOT}/skills/<skill-name>` to reference skill-local scripts. `${CLAUDE_SKILL_DIR}` also expands in `!` context (see the substitutions table in [SKILL.md](../SKILL.md) for where it does not).
- **stderr is discarded** — only stdout replaces the placeholder.
- Failed commands produce empty output. Handle this in the command itself with a fallback (e.g., `some-cmd 2>/dev/null || echo "unavailable"`).
- Commands run **synchronously and sequentially**. Avoid slow commands that would delay skill loading.

## Skills and Subagents

### Give a subagent access to skills

Custom agents in `.claude/agents/` can list skills in their `skills` field:

```yaml
# .claude/agents/code-reviewer.md
---
name: code-reviewer
description: Review code for quality and best practices
skills: pr-review, security-check
---
```

Skills listed here are injected into the subagent's context at startup. Built-in agents (Explore, Plan, general-purpose) do not inherit skills.

### Run a skill in a subagent context

Use `context: fork` to run a skill in an isolated subagent. The sub-agent starts with a **clean context**. It does not inherit the parent conversation. It sees only the skill content (with `!`shell`` injections expanded) and `CLAUDE.md`. Results are summarized and returned to the main conversation.

Forks background by default. The result arrives as a later task notification rather than in the invoking turn, the fork runs with the narrower background-subagent tool set, and its edits fall outside session checkpoints so `/rewind` will not undo them. Set `background: false` when the caller needs the result in the turn that invoked the skill.

A forked skill is a regular subagent. It never receives `AskUserQuestion`. `background: false` does not restore it. A skill whose steps depend on asking the user must run inline.

### When Not to Fork

`context: fork` loses all conversation history. If the skill needs awareness of what the user has been working on, run it inline and use `Agent` subagents to offload verbose work. The inline skill retains full context while keeping the heavy lifting out of the main conversation.

## Reasoning Effort

Pinning `effort` in frontmatter switches reasoning effort for the skill's duration and reverts when it finishes. Pin it to the level the skill's work needs, not the level the conversation happens to run at:

- `low`: mechanical work with little judgment, such as monitoring, polling, executing a fixed script, or formatting.
- `medium`: routine implementation.
- `high`: work where verification or edge cases decide the outcome, such as debugging existing code.
- `xhigh`: hard problems short of a fully autonomous run.
- `max`: long autonomous runs on hard problems.

The pin applies only when the user types the skill as a slash command. A skill invoked through the Skill tool runs at the conversation's effort.

On Claude Fable 5.1, Claude Mythos 5.1, Claude Opus 5.5, and Claude Opus 5, Claude Code sends the switch as a per-message effort change, which keeps the conversation's cached prefix. Pin freely on these models. This is confirmed on the Claude API. Bedrock, Vertex, and Foundry are unconfirmed.

Other models take effort as a top-level request parameter, so switching to the pinned level rewrites the whole cached prefix at cache-creation rates. Reverting is cheap while the pre-switch cache entry is still live, which holds only if the skill finishes within the cache TTL. On those models one rewrite outweighs what a low-effort run saves once the prefix passes a few thousand tokens. A skill re-invoked on every polling cycle pays the rewrite each time.

A skill running under `context: fork` starts a subagent with no inherited prefix, so when its pin applies it costs nothing on any model.

## Skill-Scoped Hooks

Hooks in frontmatter run during the skill's lifecycle and are cleaned up when the skill finishes. `once: true` runs a hook only once per session, then removes it, useful for one-time validation or setup.

Prefer specific matchers with tool argument patterns over generic tool names with internal filtering, combine related matchers with `|`, and use `jq -n` with YAML multi-line syntax for static JSON responses:

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash(osascript:*)|Bash(open:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
```

## Anti-Patterns

### Tool and Skill Overlap

Exposing several near-duplicate tools makes Claude pick the wrong one. Consolidate overlapping capabilities into a single parameterized tool where an argument selects behavior. The same overlap appears at the skill level: two skills whose `description` fields overlap compete to trigger. Prefer one skill with a `$ARGUMENTS`-selected mode over splitting it into rivals that race to activate.

### Over-Prescription

Prompts that micromanage the exact sequence of tool calls degrade output and become brittle. When a skill keeps accreting prescriptive steps to patch failures, the fix is usually a clearer goal or a helper script, not more steps.
