---
name: afk
description: >
  Signal that you are stepping away so the agent keeps working without
  stalling on prompts. Drives the current task to completion, batches
  reversible decisions behind safe defaults, raises only irreversible
  ones via push, and defers bandwidth- or power-heavy work when tethered,
  on battery, or lid-closed. Use via /afk or /afk <duration>.
argument-hint: "[duration]"
disable-model-invocation: true
---

# AFK

Ben is stepping away. Keep the current task moving without him at the keyboard. Assume he cannot answer in real time, never idle on a prompt for a reversible decision, and avoid bandwidth- or power-heavy work when the machine is constrained.

Duration argument: `$0` (e.g. `30m`, `2h`, `overnight`). It is a pacing and expected-return hint, not a hard timer. With no duration, run open-ended until the task is done or fully blocked.

## Read state at invocation

Ben is still present right now. Surface read-only state and let the model interpret the raw output. Interpretation and the sandbox caveat live in [references/resources.md](references/resources.md).

- Local time: !`date "+%A %H:%M"`
- Power source: !`pmset -g ps`
- Lid / clamshell: !`ioreg -r -k AppleClamshellState`
- Network addresses (tether): !`ifconfig | grep "inet "`

Classify from the output above:

- `AC Power` is plugged in, `Battery Power` is on battery. No `InternalBattery` line means a desktop (treat as AC, no battery constraint).
- A node block with `"AppleClamshellState" = Yes` means the lid is closed. `= No` means open. Empty output means no lid (desktop). Treat empty as open.
- An `inet` address in `172.20.10.0/28` (starts `172.20.10.`) means an iPhone Personal Hotspot, USB or Wi-Fi. Any other address means no tether detected. SSID is redacted in current macOS, so this subnet is the available hotspot signal.

## Handshake while present

Use this moment before Ben leaves. Keep it to a few lines, then proceed.

1. One line of detected state: power, lid, tether, and expected return if a duration was given.
2. State the contract being entered: finish the current task, batch reversible decisions behind logged defaults, defer bandwidth- and power-heavy steps under the detected constraints.
3. Remind him to switch to a permissive mode (`shift+tab` to `acceptEdits`, or `auto`) so edits and commands do not stall while he is away. This skill cannot detect or set permission mode.
4. Remind him that blocking questions reach his phone only if Remote Control is connected and push is enabled in `/config`.
5. If the in-flight task already has a genuinely ambiguous priority or a visible irreversible fork, ask it **now** with `AskUserQuestion` while he can answer cheaply. Otherwise proceed without ceremony.

## AFK contract

Once he is away, follow this until the task completes or the session is fully blocked.

### Keep moving

Never idle waiting on a prompt for a reversible decision. Choose the sensible default, record it in the log, and continue.

### Decision triage

- Reversible / safe / expected: act, log the assumption.
- Irreversible or outward-facing (rename a public API, push to a default branch, publish, send a message, delete something not created this session): never auto-do. `PushNotification` then `AskUserQuestion`. If unrelated work remains, continue it while waiting. If nothing else remains, stop.
- Whole task blocked on his input: batch the open questions, send one `PushNotification`, then `AskUserQuestion`.

### Resource gating (defer and note)

Under battery, tether, or closed lid, skip installs, large pulls, large downloads, and heavy builds. Log each skipped step with its reason. Edits, tests, git, reviews, and reads proceed normally. The gating table is in [references/resources.md](references/resources.md).

Re-read state live at the gate. Ben typically closes the lid, unplugs, and switches to a hotspot **after** typing `/afk`, as he walks away, so the invocation snapshot reflects the desk rather than the constraints that matter once he is gone. Before any gated action re-run `pmset -g ps`, `ioreg -r -k AppleClamshellState`, and `ifconfig | grep "inet "` and gate on the fresh result. These are infrequent actions and the commands are sandbox-safe, so the re-check is cheap.

### Honor existing safety rules

The base instruction against hard-to-reverse, outward-facing actions without authorization still holds and is reinforced here. AFK lowers the bar for reversible decisions only, never for irreversible ones.

### Running log

Keep a scratchpad at `tmp/afk-<HHMM>.md` (use the invocation time). Record completed steps, assumptions and defaults taken, deferred (gated) steps with reasons, and queued questions. This makes the return brief instant.

### Pacing with duration

If the task needs an external wait (CI, a deploy), use `ScheduleWakeup` to resume near the wait's end instead of idling. Aim to have a clean summary ready by the stated return. With no duration, run open-ended until done or blocked.

## Return / wrap-up

There is no signal for when Ben returns. Deliver the summary when work completes or blocks, and again on his next message. Send a final `PushNotification` (`done` or `blocked on N decisions`) so it reaches his phone if Remote Control is connected. Then present the scratchpad as a short brief: what shipped, what was assumed, what was deferred and why, and any queued questions.
