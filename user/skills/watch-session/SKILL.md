---
name: watch-session
description: >-
  Watch another Claude session and develop a skill from its turns: fix a skill under test as its runs expose defects, or draft a skill from a task done there by hand. Use when the user asks you to watch a herdr pane or session while they test a skill or demonstrate a task.
argument-hint: "<pane-id | session-uuid> [--skill <dir>] [--learn [<name>]] [--control] [--prompt <text>] [--every <duration>]"
disable-model-invocation: true
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts:*)
  - Bash(herdr agent read:*)
  - Bash(herdr agent wait:*)
---

# Watch Session

Watch another Claude session and develop a skill from what it does. In test mode, the user runs a skill in the watched session and you fix that skill after each turn that exposes a defect. In learn mode, the user does a task by hand and you draft a skill that would do it.

The watched session belongs to the user. You read its transcript and never type into it, except in control mode.

## Arguments

- `<pane-id | session-uuid>`: the watched session. A herdr pane id (`wMQ:p1`) resolves to the Claude session in that pane and follows it across `/clear`. A session UUID watches that transcript directly.
- `--skill <dir>`: the skill under test (test mode, the default). Without it, take the directory from the first `skillDirs` in a turn digest and confirm it with the user before the first edit.
- `--learn [<name>]`: learn mode, drafting a skill named `<name>`.
- `--control`: start in control mode. Default is watch mode.
- `--prompt <text>`: the prompt control mode sends to re-run the skill. Default: the last typed `prompt` whose turn invoked the skill.
- `--every <duration>`: learn-mode batch interval. Default `10m`. Test mode reacts per turn.

## State

Keep everything for one watch in `tmp/watch-session/` under your working directory, keyed by the watched session UUID from the `watching` event:

- `<uuid>.json`: the script's read offset, written through `--state-dir` so a restarted watch resumes where it stopped.
- `<uuid>.md`: your log. Append one entry per change or note, formatted like this:

  ```
  turn 88213-131040  re-ran the full benchmark after a no-op edit
    -> SKILL.md: skip the bench when the diff touches no measured path
  ```

- `<uuid>/`: the learn-mode draft (`SKILL.md` plus `questions.md`).

## Arm the Monitor

Start `Monitor` with `persistent: true` on:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts watch <target> --state-dir tmp/watch-session [--every <seconds>]
```

A new watch starts at the end of the transcript, so arm it before the user starts the run. Pass `--from-start` to read turns that already happened, as when learn mode joins a task in progress. Each stdout line is one JSON event:

- `watching`: the resolved session, transcript path, and start offset.
- `turn`: one finished turn. It carries `from`/`to` byte offsets, `prompt` and its `source` (`typed`, `system`, `queued`), `tools` counts, `errors` (failed tool results), `skills` invoked, `skillDirs` (the directories those skills loaded from), `final` (the last assistant text), and `end` (`complete` or `interrupted`).
- `blocked`: the watched agent asked the user a question. The question is the user's to answer.
- `batch`: learn mode's per-interval roll-up of the turns since the last batch.
- `session`: the pane started a new session, which the script now follows.
- `ended`: the pane no longer hosts a Claude session. Wrap up.

Read a turn in full when the digest does not settle what happened:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts show <target> <from> <to> [--truncate 500]
```

## Test Mode

Load `claude-code:skill` and `prompting:prompting` before the first edit. The goal is a skill that runs correctly without the user correcting it.

On each `turn` event:

1. Check `skillDirs` against the skill directory you edit. A mismatch means the watched session loaded another copy (a plugin cache, the deployed `~/.claude-repo` clone), and your edits will not reach it. Tell the user once and keep watching.
2. Judge whether the turn shows a defect the skill caused: a skipped or misread instruction, a wrong approach, wasted tool calls, an error the skill should have prevented, or the user correcting the agent in the next typed prompt. A correction from the user is the strongest signal. Attribute it to the skill only when a skill change would have prevented it.
3. When it does, edit the skill right away and append the change to the log. The watched session picks up `SKILL.md` changes on its next invocation. Edits under `references/` may need a fresh session, so say so when you make one.
4. When it does not, stay silent. Report a turn only when you change something or need the user.

## Control Mode

Control mode adds one step to test mode: after a turn ends and you have edited the skill, re-run it in the watched pane.

```bash
herdr agent wait <pane> --timeout 600000
herdr agent prompt <pane> "<prompt>"
```

Send only after a `turn` event and only when `agent wait` returns `idle` or `done`. Leave a `blocked` pane to the user. Switch into control mode when the user says "take control", and back to watch mode when they say "hands off" or type into the watched pane themselves (a `typed` prompt you did not send). Control needs herdr, so with a session-UUID target, stay in watch mode.

## Learn Mode

Load `claude-code:skill` and `prompting:prompting` first. The goal is a skill that would let a fresh session do the watched task without the user steering it.

Arm the monitor with `--every` in seconds. On each `batch` event, read the new range with `show`, then revise the draft in `tmp/watch-session/<uuid>/SKILL.md`. Capture the goal, the decisions the user made and why, the commands and files that mattered, and the corrections the user gave. Put what you cannot infer in `questions.md` instead of guessing. Ask those questions when the user stops the watch.

When the watch ends, ask where the skill belongs and write it there.

## Ending

The watch ends when the user says stop or a monitor event reads `ended`. Stop the monitor with `TaskStop`. Then summarize from the log: each change made, notes still open, and the draft path in learn mode.
