# Load

Paces Claude's heavy work to the machine it runs on. Unconfigured, it caps nothing and never reminds, so a VM can be saturated. On a machine shared with a person, configure it to remind the model to scale its work down as load climbs, with generous hard caps as a backstop.

## Configuration

Set these options under `pluginConfigs` in settings, keyed `load@<marketplace>`:

- `caps`: `pool:limit:regex` entries. A Bash command matching an entry's regex is refused while `limit` processes in its pool already run, while it starts several at once (`&` in a loop, `xargs -P`), or under critical memory pressure. Entries sharing a pool share its limit. Running jobs are counted from `ps`, once per process tree, so wrappers and workers don't count twice.
Thresholds are load average per core, named for what the mod does at each:

- `remind`: after any tool call, appends a reminder to the result once load reaches it or memory is under pressure. The reminder names the load, memory pressure, Claude sessions, and capped jobs running, and asks the model to weigh its next heavy step: defer it, narrow it, lower its worker and thread counts, or run it under `nice`. `0` turns reminders off.
- `warn`: a firmer reminder at this load, or under critical memory pressure, to start no heavy work the task doesn't need. Each agent hears each level once until the machine calms.
- `refuse`: refuses capped commands while load is above it. `0` turns it off.

[`user/settings.json`](../../user/settings.json) holds this repo's own values.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) gates `Bash` calls, paces every tool call, and closes an agent's browser sessions when it ends.
  - [`caps.ts`](mod/caps.ts) parses caps, samples the machine, and judges capped commands.
  - [`pace.ts`](mod/pace.ts) grades the machine and writes the reminder.
  - [`browser.ts`](mod/browser.ts) limits `agent-browser` to one session per agent and a few daemons machine-wide.
  - [`command.ts`](mod/command.ts) splits a command line into the simple commands both read.
- **Events**: launches, refusals, closes, reminders, and hook failures go to [`mod-events`](../mod-events/README.md) as `browser.*`, `cap.*`, `pace`, and `error`. `session.start` carries any caps that failed to parse.

## Tests

`bun scripts/mod-test.ts load` runs the mod's tests.
