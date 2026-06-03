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

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls. The working mechanism is the `mac` plugin's marker-based sandbox hook, which reads a `claude:dangerouslyDisableSandbox` comment from the invoked script. See [`scripts.md`](scripts.md) for the mechanism and canonical examples.

## Sandbox Trust Model

The sandbox's primary job is egress control, not filesystem lockdown. The guarantee is that credentials never enter the sandbox, so a model (or an attacker steering it) cannot exfiltrate them no matter how creative the path. Broad filesystem writes are therefore tolerable, but any widening of the egress surface (a new host, socket, or network-reaching escaped command) opens a channel data can leave through and needs a reason. The groupings below exist so a routine addition (one more cache, one more `gh`-class tool) lands in an existing bucket, while a genuinely new kind of allowance forces a fresh decision.

#### Egress allowances (the surface to guard)

`network` (mirrored by the `WebFetch(domain:...)` permission list) is where data can leave. The allowed hosts fall into three trust groups:

- Package registries: `registry.npmjs.org`, `www.npmjs.com`, `pypi.org`, `rubygems.org`, `proxy.golang.org`, `sum.golang.org`. Read-mostly public infrastructure with no credential attached.
- Docs and source: `docs.anthropic.com`, `code.claude.com`, `modelcontextprotocol.io`, `pkg.go.dev`, `bun.sh`, `bun.com`, `github.com`, `raw.githubusercontent.com`. Public read endpoints.
- Credentialed APIs: `api.github.com`, `api.linear.app`, `api.anthropic.com`, `claude.ai`. Each is trusted because its secret lives outside the sandbox (the host tool authenticates), not because the host itself is safe.

`api.anthropic.com` is the known exfil-relevant host: it accepts uploads and has served as an unintended exfiltration vector before. It stays (the agent needs the model API), but it is the reason egress control is not a complete guarantee. Treat it as the standing exception, not a precedent for adding more upload-capable hosts.

`allowUnixSockets` grants two local channels:

- The Secretive SSH agent socket (`~/Library/Containers/com.maxgoedjen.Secretive.SecretAgent/...`) is a signing channel only. Keys stay in the Secure Enclave. The sandbox can request signatures but never sees private key material.
- `~/.tmux` is local IPC to the running tmux server. It reaches nothing off the machine.

`allowLocalBinding` permits binding local ports for loopback servers. Local-only, no egress.

#### Local-only allowances (cannot exfiltrate)

`filesystem.allowWrite` covers scratch and toolchain or dependency caches: `/tmp`, `~/.cache`, `~/.terraform.d/plugin-cache`, `~/Library/Caches/go-build`, `~/src/go/pkg/{mod,sumdb}`, `~/.bun/install`, `~/.local/share/uv`, `~/.local/share/graphite`. None is a credential store. Writing here cannot move data off the machine, so the bar for adding a write path is low: confirm it is genuinely a cache or scratch directory and not somewhere secrets live.

#### Escaped commands (`excludedCommands`)

These run outside the sandbox. `excludedCommands` matches only the top-level command (see [Sandbox and Nested Commands](#sandbox-and-nested-commands) above), so escaping a wrapper does not escape what it spawns. They group by why escaping is acceptable:

- Self-authenticating network tools: `git`, `gh`, `linear`, `aws`, `gcloud`, `az`, `ssh`, `scp`, `rsync`, `docker`. Each carries its own out-of-sandbox auth and already reaches the network on its own terms. Sandboxing them only breaks their credential handling without closing a channel they don't already have.
- macOS host integration (the `mac` plugin): `open`, `osascript`, `shortcuts`, `pbcopy`, `pbpaste`, `security`, `defaults`, `screencapture`, `say`, `afplay`, `diskutil`, `networksetup`, `dscl`. Host APIs the sandbox cannot model.
- Local agent and session tooling: `wt`, `claude`, `agent-browser`, `code`. Worktree, session, and editor control that operates locally.

#### Editing guidance

Before adding an allowance, place it in the right group and apply that group's test:

- New host: which trust group does it belong to? Public read infra is low-risk. A credentialed API is acceptable only when its secret stays outside the sandbox. An upload-capable host is an egress risk, so do not add one casually.
- New socket: confirm it is a signing or local-IPC channel that reaches nothing off-machine, like the two already listed.
- New write path: confirm it is scratch or a cache, never a credential store.
- New escaped command: confirm it fits an existing rationale (self-authenticating tool, host integration, or local tooling). A network-reaching command that does not carry its own auth widens egress and should stay sandboxed.
