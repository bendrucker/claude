# Plugin Reload Experiment

## Web quick start

Local setup (run once before starting the web session):

```bash
cd tmp/plugin-reload-test && ./scripts/reset.sh
```

**Turn 1:**

```
Run ./scripts/bootstrap.sh and confirm it succeeded. Do not do anything else.
```

**Turn 2:**

```
Answer these three questions and report the result of each:
1. Try to invoke the "canary" skill using the Skill tool. What happened?
2. Say "canary check". Did any skill activate automatically?
3. Say "canary user check". Did you see an instruction to respond with CANARY_USER_MD_ALIVE?
```

## Question

Does configuration written during a Claude Code session affect plugin availability and `CLAUDE.md` visibility in subsequent turns of the same session? Or is everything resolved once at process startup?

## Hypothesis

Plugin resolution and `CLAUDE.md` loading happen at startup. Mid-session changes to `.claude/settings.json` or `~/.claude/CLAUDE.md` will not be picked up.

## Structure

```
tmp/plugin-reload-test/
├── .claude/
│   └── settings.json              # starts empty, bootstrap populates it
├── .claude-plugin/
│   └── marketplace.json           # local marketplace with "canary" plugin
├── plugins/canary/
│   ├── .claude-plugin/plugin.json
│   └── skills/canary/SKILL.md     # responds CANARY_ALIVE
├── scripts/
│   ├── bootstrap.sh               # installs config mid-session
│   └── reset.sh                   # restores clean state
├── CLAUDE.md
└── EXPERIMENT.md
```

The canary plugin defines one skill that responds with `CANARY_ALIVE` when asked "canary check". The bootstrap script writes:

- `.claude/settings.json` — enables `canary@reload-test` plugin
- `~/.claude/CLAUDE.md` — instructs Claude to respond `CANARY_USER_MD_ALIVE` to "canary user check"

## Procedure

### Baseline: confirm the plugin works at startup

```bash
cd tmp/plugin-reload-test
./scripts/bootstrap.sh
claude --plugin-dir ./plugins/canary --setting-sources local -p "canary check"
```

Expected: `CANARY_ALIVE`. This confirms the skill file is valid and loadable.

Reset after: `./scripts/reset.sh`

### Test: mid-session config installation

```bash
cd tmp/plugin-reload-test
./scripts/reset.sh
claude --setting-sources local
```

**Turn 1** — bootstrap only:

> Run `./scripts/bootstrap.sh` and confirm it succeeded. Do not do anything else.

**Turn 2** — probe all three vectors:

> Answer these three questions and report the result of each:
>
> 1. Try to invoke the "canary" skill using the Skill tool. What happened?
> 2. Say "canary check". Did any skill activate automatically?
> 3. Say "canary user check". Did you see an instruction to respond with CANARY_USER_MD_ALIVE?

### Web session variant

Same procedure but in a Claude Code web session against this repo. The web session has no `~/.claude/` at boot, making it the realistic target environment.

## Expected results

| Probe | Expected | What it tells us |
|---|---|---|
| Baseline (`--plugin-dir`) | `CANARY_ALIVE` | Plugin files are valid |
| Turn 2: Skill tool | Skill not found | Plugins frozen at startup |
| Turn 2: "canary check" | No auto-match | Skill descriptions frozen at startup |
| Turn 2: "canary user check" | No special response | `~/.claude/CLAUDE.md` frozen at startup |

## Interpreting results

**All frozen**: SessionStart hooks cannot bootstrap plugins. A feature request for user-level settings sync (like Codespaces dotfiles) is the only viable path.

**CLAUDE.md reloads, plugins don't**: Partial win. User instructions and style preferences can be bootstrapped, but skills/hooks/agents cannot.

**Everything reloads**: SessionStart hook cloning `bendrucker/claude` and running `install.sh` would fully work. This would be the solution for web sessions.
