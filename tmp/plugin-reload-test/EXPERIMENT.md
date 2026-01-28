# Plugin Reload Experiment

## Web quick start: manual bootstrap (experiment 1)

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

**Result:** All frozen. Plugins and CLAUDE.md written mid-session are not picked up.

## Web quick start: SessionStart hook (experiment 2)

Local setup (run from repo root, commits to `.claude/settings.json`):

```bash
./tmp/plugin-reload-test/scripts/reset-session-start.sh
```

Then commit and push this branch. The SessionStart hook is baked into `.claude/settings.json` and will fire automatically when the web session starts.

**Turn 1** (the only turn needed):

```
Answer these questions and report the result of each:
1. Read tmp/plugin-reload-test/.session-start.log. Did the SessionStart hook fire?
2. Read ~/.claude/CLAUDE.md. Was it written by the hook?
3. Try to invoke the "canary" skill using the Skill tool. What happened?
4. Say "canary check". Did any skill activate automatically?
5. Say "canary user check". Did you see an instruction to respond with CANARY_USER_MD_ALIVE?
6. Run: echo $CANARY_BOOTSTRAP — was the env var persisted via CLAUDE_ENV_FILE?
```

After the experiment, restore repo settings locally:

```bash
./tmp/plugin-reload-test/scripts/restore-repo-settings.sh
```

## Question

Does configuration written during a Claude Code session affect plugin availability and `CLAUDE.md` visibility in subsequent turns of the same session? Or is everything resolved once at process startup?

## Hypothesis

Plugin resolution and `CLAUDE.md` loading happen at startup. Mid-session changes to `.claude/settings.json` or `~/.claude/CLAUDE.md` will not be picked up.

## Structure

```
tmp/plugin-reload-test/
├── .claude/
│   └── settings.json                   # experiment 1: empty; experiment 2: SessionStart hook
├── .claude-plugin/
│   └── marketplace.json                # local marketplace with "canary" plugin
├── plugins/canary/
│   ├── .claude-plugin/plugin.json
│   └── skills/canary/SKILL.md          # responds CANARY_ALIVE
├── scripts/
│   ├── bootstrap.sh                    # experiment 1: manual mid-session install
│   ├── reset.sh                        # experiment 1: restore clean state
│   ├── session-start-bootstrap.sh      # experiment 2: SessionStart hook script
│   ├── reset-session-start.sh          # experiment 2: install hook + clear user config
│   └── restore-repo-settings.sh        # experiment 2: restore repo .claude/settings.json
├── CLAUDE.md
└── EXPERIMENT.md
```

The canary plugin has one skill that responds `CANARY_ALIVE` to "canary check". Both experiments write:

- `~/.claude/settings.json` — enables `canary@reload-test` plugin
- `~/.claude/CLAUDE.md` — instructs `CANARY_USER_MD_ALIVE` response to "canary user check"

The difference is **when**: experiment 1 writes during a user turn, experiment 2 writes via a SessionStart hook before the first turn.

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

## Results: experiment 1 (manual bootstrap)

All frozen. Mid-session writes to `.claude/settings.json` and `~/.claude/CLAUDE.md` are not picked up. The Skill tool itself was not even available — it's only injected when plugins are loaded at init.

## Expected results: experiment 2 (SessionStart hook)

| Probe | If frozen | If dynamic | What it tells us |
|---|---|---|---|
| `.session-start.log` exists | Hook fired | Hook fired | Hook timing |
| `~/.claude/CLAUDE.md` written | File exists | File exists | Hook ran successfully |
| Skill tool invocation | Skill not found | `CANARY_ALIVE` | Plugin resolution timing |
| "canary check" auto-match | No skill fires | Skill auto-invokes | Skill description timing |
| "canary user check" | Generic response | `CANARY_USER_MD_ALIVE` | CLAUDE.md load timing |
| `$CANARY_BOOTSTRAP` | Empty or unset | `true` | CLAUDE_ENV_FILE works |

## Interpreting results

**Hook fires but plugins/CLAUDE.md frozen**: SessionStart hooks run after plugin resolution and CLAUDE.md loading. Writing user config in a SessionStart hook is too late. The only viable path is a feature request for user-level settings sync (like Codespaces dotfiles).

**CLAUDE.md reloads but plugins don't**: Partial win. User instructions and style preferences can be bootstrapped via SessionStart, but skills/hooks/agents cannot.

**Everything reloads**: A SessionStart hook that clones `bendrucker/claude` and runs `install.sh` would fully work for web sessions.

**CLAUDE_ENV_FILE works but nothing else**: Environment variables can be bootstrapped, which enables a workaround for some use cases but not plugin loading.
