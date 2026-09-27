---
name: watch-session
description: >-
  Watch another Claude session and develop a skill from its turns: fix a skill under test as its runs expose defects, or draft a skill from a task done there by hand. Use when the user asks you to watch a herdr pane or session while they test a skill or demonstrate a task.
argument-hint: "<pane-id | session-uuid> [--skill <dir> | --learn <name>] [--prompt <text>] [--every <duration>]"
disable-model-invocation: true
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts:*)
  - Bash(herdr agent read:*)
  - Bash(herdr agent wait:*)
---

# Watch Session

Develop a skill by watching the user work in another Claude session, then proving each revision in a trial. The goal is a skill that lets a fresh session reach the user's result without the user steering it. Watching tells you what to try. A trial settles whether it works.

The user's session belongs to the user. You read its transcript, and type into it only when the user asks, such as to start the run they want watched: `herdr agent prompt <pane> "<prompt>"` once `herdr agent wait <pane>` returns. Omit `--until`, because a pane in an unseen tab rests at `done` and the default matches it. Trials run in a pane you open and own.

## Arguments

- `<pane-id | session-uuid>`: the user's session. A herdr pane id (`wMQ:p1`) resolves to the Claude session in that pane and follows it across `/clear`. A session UUID watches that transcript directly.
- `--skill <dir>`: start from an existing skill and edit it in place. Without it or `--learn`, take the directory from the first `skillDirs` in a turn digest and confirm it with the user before the first edit.
- `--learn <name>`: start from nothing and draft a skill named `<name>` in `tmp/watch-session/<uuid>/.claude/skills/<name>/`.
- `--prompt <text>`: the prompt a trial sends. Default: the user's first typed `prompt` of the task.
- `--every <duration>`: batch interval while observing a hand-done task. Default `10m` with `--learn`, per turn otherwise.

Load `claude-code:skill` and `prompting:prompting` before the first edit.

## State

Keep everything for one watch in `tmp/watch-session/` under your working directory, keyed by the user's session UUID from the `watching` event:

- `<uuid>.json`: the script's read offset, written through `--state-dir`.
- `<uuid>.md`: your log. Append one entry per revision, trial, or open question:

  ```
  turn 88213-131040  re-ran the full benchmark after a no-op edit
    -> SKILL.md: skip the bench when the diff touches no measured path
  trial 2  reached the user's end state, 1 wasted bench run
  ```

- `<uuid>/`: the `--learn` draft, plus `questions.md` for what only a trial or the user can answer.

## Watching a Session

Start `Monitor` with the maximum `timeout_ms` on the command below, converting `--every` to seconds. A monitor expires after that timeout, so re-arm it with the same command on each expiry. The state file resumes the read where the last one stopped.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts watch <target> --state-dir tmp/watch-session [--every <seconds>]
```

A new watch starts at the end of the transcript, so arm it before the user starts. Pass `--from-start` to include turns already taken. Each stdout line is one JSON event:

- `waiting`: the session has not written a transcript yet, which happens at its first message. The watch starts on its own once it does.
- `watching`: the session, transcript path, `cwd`, and `head` (the commit checked out there). Record `head` from the first `watching` event as the trial base, since a re-armed watch reports the current commit.
- `turn`: one finished turn, with `from`/`to` byte offsets, `prompt` and its `source` (`typed`, `system`, `queued`), `tools` counts, `errors` (failed tool results), `skills` invoked, `skillDirs` (the directories those skills loaded from), `final` (the last assistant text), and `end` (`complete` or `interrupted`).
- `blocked`: the watched agent asked a question. It is the user's to answer.
- `batch`: the `--every` roll-up of turns since the last batch.
- `session`: the pane started a new session, which the script now follows.
- `ended`: the pane no longer hosts a Claude session.

Read a range in full when the digest does not settle what happened:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts show <target> <from> <to> [--truncate 500]
```

## The Loop

Cycle through these until a trial comes back clean:

1. **Observe.** On each `turn` or `batch` from the user's session, find what the skill should capture or fix: a decision the user made and why, a command or file that mattered, a correction the user gave, or a skill instruction the agent skipped, misread, or wasted calls on. A correction from the user is the strongest signal. Stay silent on any other turn.
2. **Revise.** Edit the skill and log the change. Put what you cannot infer in `questions.md` instead of guessing.
3. **Propose a trial** when the skill covers the task end to end, or when an open question is one a trial can answer. Say what the trial will test and start it when the user agrees, or when the user asks for one.
4. **Trial.** Run the skill in the trial pane (see [Trials](#trials)) and watch it with a second monitor.
5. **Compare.** Hold the trial against the user's run: the same end state, the same decisions, no step the user had to correct. Each gap is an observation for the next revision. Log the trial's outcome.

A trial is clean when it reaches the user's end state and shows no defect you would fix. After a clean trial, report it and stop proposing trials. The next move is the user's: watch more, try a variant task, or finish.

## Trials

Load `herdr:herdr` for the pane mechanics. A trial needs the user's starting state, the skill copy you edit, and a fresh session each time.

Once per watch, create a disposable worktree of `cwd` at the recorded `head`, with its own pane, without taking focus: `herdr worktree create --cwd <main checkout> --branch watch-trial-<name> --base <head> --no-focus`.

For each trial:

1. Reset the worktree to `head` and clean it, so every trial starts from the user's starting state.
2. Start a fresh Claude session in the trial pane with the skill loaded: `herdr agent start trial-<name> --kind claude --pane <pane> -- <load args>`. A `--learn` draft loads with `--add-dir tmp/watch-session/<uuid>` (absolute) and runs as `/<name>`. A plugin skill loads with `--plugin-dir <plugin root>`. Answer the trust dialog a new worktree raises, since the pane is yours.
3. Arm a second monitor on the trial pane with `--from-start`, then send the trial prompt with `herdr agent prompt`.
4. Check the first `skillDirs` the trial reports. A path other than the copy you edit means the trial ran another copy, so the result does not count.

Answer a `blocked` trial yourself when the user's run shows the answer. Otherwise relay the question to the user. End each trial by prompting `/exit`, which also ends its monitor with `ended`.

## Ending

The watch ends when the user says stop or the user's monitor reads `ended`. Stop both monitors with `TaskStop`. Close the trial pane, remove the trial worktree with `herdr worktree remove`, and delete its branch. Summarize from the log: revisions made, trials run and their outcomes, and open questions. With `--learn`, ask where the skill belongs and move it there.
