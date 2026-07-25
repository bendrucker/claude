---
paths:
  - "**/settings*.json"
---

# Settings

User-level settings live in `user/settings.json` (plugins, permissions, sandbox). Project-level settings live in `.claude/settings.json` (biome hook). See the [settings documentation](https://code.claude.com/docs/en/settings) for available options.

## Permission Paths

Permission patterns starting with `/` are relative to the settings file, not absolute filesystem paths. Use `//` for absolute paths:

- `Edit(tmp/**)` → `<cwd>/tmp/**` (relative to current directory)
- `Edit(//tmp/**)` → `/tmp/**` (absolute)
- `Edit(~/.config/**)` → home directory (tilde expansion works)

## Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls. Go CLIs run sandboxed via `sandbox.network.allowMachLookup`; wrappers that hand off to Apple Events or Launch Services need a full skip via the `mac` plugin's `claude:dangerouslyDisableSandbox` marker hook. See [`scripts.md`](scripts.md).

## Plugin Data Dir

The runtime sandbox profile denies writes under `~/.claude/plugins`, and that deny shadows any `filesystem.allowWrite` entry beneath it. `~/.claude/plugins/data` was listed in `allowWrite` for a while and never took effect, so do not re-add it. The failure surfaces as a bare `Operation not permitted`, naming neither the deny rule nor the entry it shadows.

This is an upstream defect, not a policy we chose. The write profile emits every `allowOnly` rule before every `denyWithinAllow` rule, and Seatbelt takes the last matching rule, so a broad deny always beats a narrow allow no matter how specific. The read profile does not have this problem: it implements `allowWithinDeny`, so a narrower allow can reopen a denied region. Writes have no equivalent primitive, and the [sandboxing docs](https://code.claude.com/docs/en/sandboxing) state the specificity rule only for reads. Confirmed with `sandbox-exec`: given a deny of a parent and an allow of a child, emitting the allow first denies the child, and emitting it last permits the child while the rest of the parent stays denied.

So the fix belongs upstream, and nothing in this repo's settings can express it today.

Meanwhile, the four session-index writers carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker. That is a bridge around a bug, not the intended design, and it trades real sandbox coverage for a working toolchain.

**Removal criterion.** Drop the markers when this probe succeeds under the sandbox:

```
touch ~/.claude/plugins/data/.sandbox-probe && rm ~/.claude/plugins/data/.sandbox-probe
```

Do not wait for an upstream announcement. [#41156](https://github.com/anthropics/claude-code/issues/41156) raised the same conflict at the permission-prompt layer, was wrongly auto-flagged as a duplicate, and was closed `NOT_PLANNED` by a staleness bot after two and a half months. Related: [#51973](https://github.com/anthropics/claude-code/issues/51973), [#34900](https://github.com/anthropics/claude-code/issues/34900). Treat the probe as the only reliable signal.

## Sandbox Trust Model

The sandbox is egress control, not filesystem lockdown. Credentials stay outside its reach, so a sandboxed process cannot exfiltrate them. Broad filesystem writes are fine, but a new host, socket, or network-reaching escaped command widens the egress surface and needs justification.

### Hosts (`WebFetch(domain:...)` Permissions)

- Package registries: `registry.npmjs.org`, `www.npmjs.com`, `pypi.org`, `rubygems.org`, `proxy.golang.org`, `sum.golang.org`, `community-extensions.duckdb.org` (DuckDB community extensions `markdown`/`yaml`, fetched on first `INSTALL ... FROM community`).
- Docs and source: `platform.claude.com`, `code.claude.com`, `modelcontextprotocol.io`, `pkg.go.dev`, `bun.sh`, `bun.com`, `github.com`, `raw.githubusercontent.com`. `docs.anthropic.com` stays as the legacy host that 301-redirects to the first two, so the first leg of a redirect still resolves without a prompt.
- Credentialed APIs: `api.github.com`, `api.linear.app`, `api.anthropic.com`, `claude.ai`, `gitlab.com`, `*.greptile.com`, `*.coderabbit.ai`. Trusted only because each secret lives outside the sandbox, except `gitlab.com`, `*.greptile.com`, and `*.coderabbit.ai` (see below).

**Removal criterion.** The grant only buys the first leg of a redirect, so it dies with the redirect:

```
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://docs.anthropic.com/en/docs/claude-code/settings
```

Today: `301 https://code.claude.com/docs/en/settings`. Once that is no longer a 3xx into a host already listed above, drop it.

`www.schemastore.org` is granted in `.claude/settings.json` rather than here, because only this repo fetches it, through `schemas/overlays/sources.json`. It is unauthenticated and read-only, so the secrets-outside rule needs no caveat for it.

**Removal criterion.** Drop it when no overlay resolves its base live:

```
jq -r '.schemas[].url' schemas/overlays/sources.json | grep schemastore.org
```

The overlay design fetches every base at validation time, so this only empties if the upstream-backed schemas become hand-authored or vendored. See [`schemas.md`](schemas.md).

`api.anthropic.com` is the known exfil-capable host (it accepts uploads). It stays because the agent needs the model API.

`gitlab.com` is a partial exception to the secrets-outside rule: `glab` stores its OAuth token in `~/.config/glab-cli/config.yml` (no keychain support), which the sandbox can read. A sandboxed process can therefore exfiltrate that token through any allowlisted egress host, and `gitlab.com` itself accepts uploads (snippets, repos). Accepted because the alternative was near-universal `dangerouslyDisableSandbox` on `glab` calls, which exposed far more. The write allowlist covers only `~/.config/glab-cli/recover` (`glab`'s crash-recovery files), not the config file itself.

`*.greptile.com` is the same partial exception: the `greptile` CLI (run sandboxed by `pull-request:follow-up --local`) stores its token in `~/.greptile/auth.json`, which the sandbox can read, and reaches `api.`/`auth.`/`app.greptile.com` for login and reviews. The wildcard covers those subdomains without listing each. Accepted so `greptile review` runs sandboxed rather than escaped; the token is exfiltrable through any allowlisted host, and greptile's own hosts accept uploads.

`*.coderabbit.ai` is the same partial exception: the `coderabbit` CLI (run sandboxed by `pull-request:follow-up --local`) stores its token in `~/.coderabbit/auth.json`, which the sandbox can read, and reaches `cli.`/`app.coderabbit.ai` for login and reviews. The wildcard covers those subdomains without listing each. Accepted so `coderabbit review` runs sandboxed rather than escaped. The token is exfiltrable through any allowlisted host, and coderabbit's own hosts accept uploads.

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
