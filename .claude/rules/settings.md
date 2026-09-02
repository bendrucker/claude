---
paths:
  - "**/settings*.json"
---

# Settings

`user/settings.json` holds user-level config (plugins, permissions, sandbox, hooks). `.claude/settings.json` holds project-level config. See the [settings documentation](https://code.claude.com/docs/en/settings) for available options.

Read [`hooks.md`](hooks.md) before adding or changing a hook entry in either file.

Why each sandbox grant and hook exists, and what would retire it, is in [`docs/settings.md`](../../docs/settings.md). Read it before adding, removing, or narrowing a host, write path, socket, escaped command, or hook entry.

## Permission Paths

A pattern starting with `/` is relative to the settings file. Use `//` for absolute paths. Tilde expansion works.

- `Edit(tmp/**)` → `<cwd>/tmp/**`
- `Edit(//tmp/**)` → `/tmp/**`
- `Edit(~/.config/**)` → home directory

## Auto Mode

`autoMode` is read from `user/settings.json`, managed settings, and `--settings`. It is ignored in `.claude/settings.json` and `.claude/settings.local.json`, so a project-level block is silently inert.

Keep the literal `"$defaults"` in every `autoMode` array. Without it the array replaces its section's built-in list, dropping the force-push, `curl | bash`, production-deploy, and data-exfiltration rules. Omitting a section's key entirely is safe.

`"$defaults"` appends rather than merging by key, so write each `environment` override in the built-ins' `**Key**: value` form.

Tiers resolve in order: `hard_deny`, `soft_deny`, `allow` overriding a matching `soft_deny`, then explicit user intent. A rule that must survive a built-in `allow` belongs in `hard_deny` or in `permissions.ask`, which runs before the classifier.

Point the CLI at a worktree copy to test an edit. It otherwise resolves the deployed `~/.claude-repo` checkout:

```sh
claude --settings "$PWD/user/settings.json" auto-mode critique
```

Scopes combine rather than replace, so that run still carries the deployed file's entries alongside the worktree's.

## Sandbox

`excludedCommands` matches only the top-level command of a Bash invocation. Nested calls inherit the sandbox, and a `cd <dir> && <verb>` prefix forfeits the exemption. Use a tool's own directory flag instead: `git -C <dir> <subcommand>`, `--cwd`, `--directory`. A wrapper that hands off to Apple Events or Launch Services needs a full skip via the `mac` plugin's marker hook, covered in [`scripts.md`](scripts.md).

`filesystem.allowWrite` cannot narrow a deny, because a broad deny always wins. `~/.claude/plugins`, `~/.claude/jobs`, and `~/.claude/projects` are denied, so any entry beneath them is inert. Do not add one.

An `allowWrite` path with no glob character covers everything beneath it. A path containing `*`, `?`, `[`, or `]` matches that one path and nothing inside it, and the harness strips a trailing `/**`. Spell a recursive glob path `/**/*`.

The sandbox is egress control, not filesystem lockdown. Broad filesystem writes are fine. A new host, socket, or escaped command widens the egress surface and needs a justification recorded in [`docs/settings.md`](../../docs/settings.md).
