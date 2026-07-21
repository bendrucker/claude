---
paths:
  - "**/settings*.json"
---

# Settings

User-level settings live in `user/settings.json` (plugins, permissions, sandbox). Project-level settings live in `.claude/settings.json` (biome hook). See the [settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings) for available options.

## Permission Paths

Permission patterns starting with `/` are relative to the settings file, not absolute filesystem paths. Use `//` for absolute paths:

- `Edit(tmp/**)` → `<cwd>/tmp/**` (relative to current directory)
- `Edit(//tmp/**)` → `/tmp/**` (absolute)
- `Edit(~/.config/**)` → home directory (tilde expansion works)

## Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls. Go CLIs run sandboxed via `sandbox.network.allowMachLookup`; wrappers that hand off to Apple Events or Launch Services need a full skip via the `mac` plugin's `claude:dangerouslyDisableSandbox` marker hook. See [`scripts.md`](scripts.md).

## Plugin Data Dir Is Unwritable

The runtime sandbox profile denies writes under `~/.claude/plugins`, and that deny shadows any `filesystem.allowWrite` entry beneath it. `~/.claude/plugins/data` was listed in `allowWrite` for a while and never took effect, so do not re-add it. The failure surfaces as a bare `Operation not permitted`, naming neither the deny rule nor the entry it shadows.

Plugin scripts that must write their own data dir carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker instead.

## Sandbox Trust Model

The sandbox is egress control, not filesystem lockdown. Credentials stay outside its reach, so a sandboxed process cannot exfiltrate them. Broad filesystem writes are fine, but a new host, socket, or network-reaching escaped command widens the egress surface and needs justification.

### Hosts (`WebFetch(domain:...)` Permissions)

- Package registries: `registry.npmjs.org`, `www.npmjs.com`, `pypi.org`, `rubygems.org`, `proxy.golang.org`, `sum.golang.org`, `community-extensions.duckdb.org` (DuckDB community extensions `markdown`/`yaml`, fetched on first `INSTALL ... FROM community`).
- Docs and source: `docs.anthropic.com`, `code.claude.com`, `modelcontextprotocol.io`, `pkg.go.dev`, `bun.sh`, `bun.com`, `github.com`, `raw.githubusercontent.com`.
- Credentialed APIs: `api.github.com`, `api.linear.app`, `api.anthropic.com`, `claude.ai`, `gitlab.com`. Trusted only because each secret lives outside the sandbox.

`api.anthropic.com` is the known exfil-capable host (it accepts uploads). It stays because the agent needs the model API.

`gitlab.com` is a partial exception to the secrets-outside rule: `glab` stores its OAuth token in `~/.config/glab-cli/config.yml` (no keychain support), which the sandbox can read. A sandboxed process can therefore exfiltrate that token through any allowlisted egress host, and `gitlab.com` itself accepts uploads (snippets, repos). Accepted because the alternative was near-universal `dangerouslyDisableSandbox` on `glab` calls, which exposed far more. The write allowlist covers only `~/.config/glab-cli/recover` (`glab`'s crash-recovery files), not the config file itself.

### Sockets and Writes

Treat this section as a trust model, not an exhaustive mirror of `settings.json`.

- `allowUnixSockets` should be local IPC endpoints where secret material never leaves a dedicated agent (for example, signing daemons or tmux sockets).
- `allowLocalBinding` should stay loopback-only.
- `filesystem.allowWrite` should allow only scratch/cache/worktree paths that tools must mutate, and never credential stores or broad home-directory globs. `~/.local/share/atuin` is a deliberate exception to the credential-store clause: the dir holds atuin's sync encryption key and the session tokens in `meta.db`. Atuin opens `meta.db` read-write on every command, including the history reads behind the `atuin:history` skill, and SQLite creates journal and WAL files beside its dbs, so a file-level grant would fail intermittently. The sandbox grants no egress to atuin's sync hosts, so the risk is local tampering: a swapped key or token would first reach the network through a later unsandboxed `atuin sync`.

### Escaped Commands (`excludedCommands`)

Run outside the sandbox; only the top-level command matches (see [Sandbox and Nested Commands](#sandbox-and-nested-commands)).

- Self-authenticating network tools: `git`, `linear`, `aws`, `gcloud`, `az`, `ssh`, `scp`, `rsync`, `docker`. Each carries its own auth and already reaches the network.
- macOS host integration (`mac` plugin): `open`, `osascript`, `shortcuts`, `pbcopy`, `pbpaste`, `security`, `defaults`, `screencapture`, `say`, `afplay`, `diskutil`, `networksetup`, `dscl`. Host APIs the sandbox cannot model.
- Local session tooling: `wt`, `claude`, `agent-browser`, `code`. Worktree, session, and editor control that stays local.

A new host needs its secret kept outside the sandbox, and never add an upload-capable one casually. A new escaped command must fit a group above. If it reaches the network without its own auth, keep it sandboxed.
