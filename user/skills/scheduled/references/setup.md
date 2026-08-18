# Setup

First-run interview. Produces `~/.config/claude-scheduled/config.json`, which declares which group directories this machine manages.

## Detect Before Asking

- Read the hostname (`scutil --get ComputerName`, falling back to `hostname`) to suggest a machine identity for the interview.
- Check for existing `user/scheduled/*` directories in this repo checkout (in-repo group candidates).
- Check `~/.config/claude-scheduled/*` for out-of-repo group directories from a prior setup.

## Interview

Ask via AskUserQuestion:

- Which groups does this machine manage? Offer every detected directory from above, plus the option to declare a new group.
- For each new group: a name (becomes the launchd label segment `me.bendrucker.claude.<group>.*` and the directory's basename) and whether it is in-repo or out-of-repo. In-repo groups live under `user/scheduled/<group>` and are committed. Out-of-repo groups live under `~/.config/claude-scheduled/<group>` and stay off GitHub, for a machine whose task set is proprietary (a work laptop).

## Persist

Run `mkdir -p ~/.config/claude-scheduled`, then write `config.json`:

```json
{ "version": 1, "groups": [ { "name": "home", "dir": "~/src/bendrucker/claude/user/scheduled/home" } ] }
```

For a new out-of-repo group, also `mkdir -p` its directory. `sync` reads every `*.yaml`/`*.yml` file in a group directory, so an empty directory just means nothing to reconcile yet.

Echo the written config back for confirmation, then continue into the originally requested mode if there was one.

## Re-Run

`/scheduled setup` re-runs the interview. The current config is already injected at the top of `SKILL.md`, so offer each current group as a default answer, plus the option to add or remove a group.
