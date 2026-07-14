---
name: claude-code:handoff
description: Hand the current conversation off to a fresh background agent that picks up the work immediately, so you can step away and track it independently. Use when the user wants to background the current work, keep going without them, continue in a separate session, or says "hand this off", "run this in the background", "keep working on this while I'm gone", or "spin up an agent to finish this".
argument-hint: "[what the next session should focus on]"
allowed-tools:
  - Bash(claude --bg:*)
  - Bash(claude agents:*)
  - Read
  - Grep
  - Glob
---

# Handoff

Hand the current work to a fresh background agent seeded with a summary of this conversation. The agent starts immediately in the current directory and returns control, so you can walk away and check on it later. Nothing is written to disk: the summary becomes the new agent's opening prompt.

Use this to make backgrounding a natural next step, not a special ceremony. When the work is well-scoped and the user wants to step away or parallelize, offer the handoff.

## Write the Summary

Synthesize the conversation into a prompt that lets an agent with zero prior context resume without asking questions. Cover:

- **Goal**: what the work is trying to achieve, in one or two sentences.
- **State**: what is done, what is in progress, what is untouched.
- **Decisions**: choices already made and the reasoning, so the agent does not relitigate them.
- **Next steps**: the concrete actions to take, in order.
- **Anchors**: the branch, PR, issue, plan doc, or key files by path or URL. Point at these rather than restating them.
- **Suggested skills**: a short list of skills the agent should invoke for this work (e.g. `pull-request:create`, `code-review`, a project skill). This is the biggest lever on whether the agent picks up your conventions.
- **Constraints**: anything that would surprise a fresh agent, such as test commands, gotchas, or things not to touch.

Keep it dense and specific. Do not duplicate content that already lives in an artifact (a plan, an ADR, an issue, a diff). Reference it by path or URL and let the agent read it.

If the user passed an argument, treat it as the focus for the next session and shape the summary around it. With no argument, summarize the conversation as a whole.

## Redact

The summary becomes the agent's prompt, so strip anything sensitive before launching: API keys, tokens, passwords, connection strings, PII. Reference where a secret lives (an env var, a secrets manager) rather than its value.

## Size the Run

The agent runs unattended, so choose its horsepower and autonomy up front. Propose all three to the user with the launch command and your reasoning, and let them override.

#### Model and Effort

Match `--model` and `--effort` to the task rather than reflexively picking the biggest. A well-specified, mechanical task runs fine on `--model sonnet` at `--effort medium`. Reserve `--model opus` with `--effort high` (or `xhigh`/`max`) for open-ended, high-stakes, or reasoning-heavy work. `--effort` takes `low`, `medium`, `high`, `xhigh`, or `max`. `--model` takes an alias (`opus`, `sonnet`, `haiku`, `fable`) or a full model name.

#### Permission Mode

The agent cannot answer permission prompts while the user is away, so pick a `--permission-mode` that lets it make progress at a risk the user accepts. Background sessions isolate in their own worktree, so the blast radius of a coding task is already contained. Weigh the choice against how reversible and contained the work is:

- `acceptEdits`: auto-accept file edits while still gating riskier actions. A sane default for contained coding work.
- `bypassPermissions`: fully unattended, no gating. Use only when the work is contained and reversible and the user accepts it.
- `plan`: the agent plans and stops for approval before acting. Fits speculative or high-risk work the user wants to inspect first, at the cost of the agent pausing rather than finishing.
- `auto`, `dontAsk`, and `manual` are also available. `manual` is the standard interactive prompting.

## Launch

Confirm the summary and the sizing with the user unless they already told you to launch, then start the agent:

```bash
claude --bg --name "<descriptive name>" --model <model> --effort <level> --permission-mode <mode> "<summary>"
```

- Always pass `--name` (`-n`). It sets the display name in the agent list, session picker, and terminal title, so a glance tells the user which job is which.
- Pass `--model`, `--effort`, and `--permission-mode` with the values chosen in [Size the Run](#size-the-run) so the run's horsepower and autonomy are set deliberately for this task.
- The agent starts in the current working directory and returns control immediately.
- Background sessions run in their own isolated git worktree by default (`worktree.bgIsolation`), so uncommitted changes in the current tree may not carry over. Commit first, or anchor the summary to a pushed branch, PR, or commit rather than unsaved edits.
- `--bg` cannot be combined with `-p`.

## Track and Interact

Tell the user how to follow and steer the agent they just launched:

- `claude agents` opens the agent view. Arrow to a session, `Space` to peek at its output without leaving, `Enter` to attach and chat interactively, `←` on an empty prompt to step back out.
- `claude attach <session-id>` jumps straight into a session. `claude logs <session-id>` prints recent output. `claude stop <session-id>` and `claude rm <session-id>` end and remove it.
- `claude agents --json` lists sessions programmatically.
- From inside any session, `/bg` backgrounds work and `/tasks` shows running agents.

The agent view marks each session: green `✓` completed, red `✗` failed, yellow `✻` needs input, dim `∙` idle. There is no push notification, so the user checks back through the agent view. Sessions idle out after about an hour unless pinned.

## Gotchas

- **Zero shared memory.** The new agent sees only the summary, not this conversation. Anything you leave out is lost. When in doubt, name the file or artifact so the agent can read it itself.
- **Isolated worktree.** The default `bgIsolation` means the agent works on a copy, not your live tree. Reference committed, pushed state for anything the agent must build on.
- **No unattended autonomy by accident.** A summary that assumes approvals will happen stalls behind the first prompt. The chosen `--permission-mode` is what actually lets the agent finish while the user is away.
