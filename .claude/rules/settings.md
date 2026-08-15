---
paths:
  - "**/settings*.json"
---

# Settings

User-level settings live in `user/settings.json` (plugins, permissions, sandbox). Project-level settings live in `.claude/settings.json` (biome hook). See the [settings documentation](https://code.claude.com/docs/en/settings) for available options.

Read [`hooks.md`](hooks.md) before adding or changing a hook entry in either file. Its `paths` globs cover `hooks.json` only, so it does not auto-inject here, and roughly half this repo's hook entries live in these two files.

## Permission Paths

Permission patterns starting with `/` are relative to the settings file, not absolute filesystem paths. Use `//` for absolute paths:

- `Edit(tmp/**)` → `<cwd>/tmp/**` (relative to current directory)
- `Edit(//tmp/**)` → `/tmp/**` (absolute)
- `Edit(~/.config/**)` → home directory (tilde expansion works)

## Auto Mode

`permissions.defaultMode` is `auto`, so the classifier is the gate on nearly every tool call. Two consequences shape where auto mode config can live and how to test it.

The classifier reads `autoMode` from `~/.claude/settings.json` (this repo's `user/settings.json`), from managed settings, and from the `--settings` flag. It deliberately ignores `.claude/settings.json` and `.claude/settings.local.json`, because a checked-in repo or a build step could otherwise inject its own allow rules. So an `autoMode` block in project settings is silently inert. There is no per-repo layer for it.

That also means `claude auto-mode config` and `claude auto-mode critique` resolve `~/.claude/settings.json` through its symlink to the deployed `~/.claude-repo` checkout. A worktree edit is invisible to them until it merges, so point them at the working copy explicitly:

```sh
claude --settings "$PWD/user/settings.json" auto-mode config
claude --settings "$PWD/user/settings.json" auto-mode critique
```

Settings scopes combine rather than replace, so a `--settings` run still carries the deployed file's entries alongside the worktree's. Read a critique of a section you shortened with that in mind.

Every array in `autoMode` replaces the built-in list for its section unless it contains the literal `"$defaults"`. Omitting it from `soft_deny` discards force push, `curl | bash`, and production-deploy protection. Omitting it from `hard_deny` discards the data-exfiltration rule. Keep `"$defaults"` in every list. Omitting a section's key entirely is safe and keeps that section's built-ins.

`"$defaults"` appends rather than merging by key, so an `environment` override lands beside the built-in it supersedes and the classifier reads both. Write each override in the built-ins' `**Key**: value` form so the pairing is legible. Without it, a custom `Repository visibility` line sits next to `**Repository visibility**: assume private ...` with nothing marking which one governs.

The four rule tiers resolve in a fixed order. `hard_deny` blocks unconditionally, then `soft_deny` blocks, then `allow` overrides matching `soft_deny` entries, and finally explicit user intent clears whatever is left. So a custom `soft_deny` cannot outrank a built-in `allow` by asserting that it does. A rule that must survive a built-in allow belongs in `hard_deny`, or in `permissions.ask`, which runs before the classifier.

`useAutoModeDuringPlan` needs no entry. It defaults on as of v2.1.218 and routes plan-mode shell commands through the classifier instead of prompting them. The gate is that auto mode is *available* to the account, so this is not a reason to set `defaultMode`. The settings schema muddies it by saying the key "has no effect unless `permissions.defaultMode` allows auto", which reads as the availability gate rather than a requirement that the active mode be `auto`.

Classifier denials reach no durable surface on their own. The [`permission-denied`](../../user/hooks/permission-denied) hook logs them so the rules stay measurable.

## Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls. Go CLIs run sandboxed via `sandbox.network.allowMachLookup`; wrappers that hand off to Apple Events or Launch Services need a full skip via the `mac` plugin's `claude:dangerouslyDisableSandbox` marker hook. See [`scripts.md`](scripts.md).

The same rule makes a `cd <dir> && <verb>` prefix silently forfeit the exemption. Take `cd <dir> && git push`. Its top-level token is `cd`, so the `git` entry in `excludedCommands` never matches and the whole compound runs sandboxed. The command then fails on egress, and the fallback is a full `dangerouslyDisableSandbox` skip. Prefer a tool's own directory-targeting flag so the exempt verb stays top-level: run `git -C <dir> <subcommand>` instead of `cd <dir> && git <subcommand>`, and the equivalent `-C`/`--cwd`/`--directory` where another tool offers one. This recovers the exemption for the common cross-worktree `git` case. It is guidance rather than enforcement, and it does not cover private-host egress, which belongs in a local-only layer.

## Plugin Data Dir

The runtime sandbox profile denies writes under `~/.claude/plugins`, and that deny shadows any `filesystem.allowWrite` entry beneath it. `~/.claude/plugins/data` was listed in `allowWrite` for a while and never took effect, so do not re-add it. The failure surfaces as a bare `Operation not permitted`, naming neither the deny rule nor the entry it shadows.

This is an upstream defect, not a policy we chose. The write profile emits every `allowOnly` rule before every `denyWithinAllow` rule, and Seatbelt takes the last matching rule, so a broad deny always beats a narrow allow no matter how specific. The read profile does not have this problem: it implements `allowWithinDeny`, so a narrower allow can reopen a denied region. Writes have no equivalent primitive, and the [sandboxing docs](https://code.claude.com/docs/en/sandboxing) state the specificity rule only for reads. Confirmed with `sandbox-exec`: given a deny of a parent and an allow of a child, emitting the allow first denies the child, and emitting it last permits the child while the rest of the parent stays denied.

So the fix belongs upstream, and nothing in this repo's settings can express it today.

A second confirmed instance is `~/.claude/jobs/*/tmp`. The harness tells background-job sessions to write temp files under `$CLAUDE_JOB_DIR/tmp` (`~/.claude/jobs/<id>/tmp`), but `~/.claude/jobs` is a harness-injected `denyWithinAllow` entry, so an `allowWrite` for any subpath is inert for the same reason. The harness generates the deny, so `user/settings.json` cannot narrow it either. Background jobs fall back to `$TMPDIR` (`/tmp`), which is writable, at the cost of the cross-job clobbering the per-job directory was meant to prevent. Do not add a `~/.claude/jobs` subpath to `allowWrite`.

Meanwhile, the four session-index writers carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker. That is a bridge around a bug, not the intended design, and it trades real sandbox coverage for a working toolchain.

**Removal criterion.** Drop the markers when this probe succeeds under the sandbox:

```
touch ~/.claude/plugins/data/.sandbox-probe && rm ~/.claude/plugins/data/.sandbox-probe
```

Do not wait for an upstream announcement. [#41156](https://github.com/anthropics/claude-code/issues/41156) raised the same conflict at the permission-prompt layer, was wrongly auto-flagged as a duplicate, and was closed `NOT_PLANNED` by a staleness bot after two and a half months. Related: [#51973](https://github.com/anthropics/claude-code/issues/51973), [#34900](https://github.com/anthropics/claude-code/issues/34900). Treat the probe as the only reliable signal.

## Sandbox Path Globs

A `filesystem.allowWrite` entry with no glob character becomes a Seatbelt `(subpath ...)` rule and covers everything beneath it. An entry containing `*`, `?`, `[`, or `]` becomes a `(regex ...)` rule anchored at both ends, so it matches that one path and nothing inside it. `/var/folders/*/*/T` granted the per-user temp directory itself while every `mktemp` inside it failed with a bare `Operation not permitted`.

A trailing `/**` does not fix that. The harness strips `/**` off the end of every sandbox path before building the profile, which is what turns a plain `/foo/**` into the recursive `(subpath "/foo")` and what turns `/var/folders/*/*/T/**` straight back into the anchored regex. The spelling that survives the strip and still recurses is `/**/*`, which compiles to `(.*/)?[^/]*` after the glob prefix and matches any depth. `/var/folders/*/*/T/*` reaches direct children only, so `mkdir` succeeds and writing inside the new directory fails.

Verified against Claude Code 2.1.232. Nested `claude --settings <file> -p` runs compared the spellings end to end: the bare glob and `/**` both failed on `touch <tmpdir>/probe`, `/*` failed one level deeper, and `/**/*` passed `touch`, nested `mkdir`, `mktemp`, and `mktemp -d`. `--settings` combines with the deployed file rather than replacing it, so the broken entry was present throughout and only the added spelling can account for the difference between runs. `sandbox-exec` on hand-written profiles confirmed the rule semantics underneath: an anchored `(regex "^/private/var/folders/[^/]*/[^/]*/T$")` denies a child, and the same pattern ending `/.*$` permits it.

No deny shadows `/var/folders`. A literal non-glob entry for the resolved temp directory grants writes inside it, which rules out the `denyWithinAllow` precedence trap documented above.

Seatbelt matches resolved paths, so a rule spelled `/var/...` matches nothing on macOS. The harness realpaths the literal prefix of each entry before emitting it, which is why `/var/folders/...` works in settings and why a hand-written probe profile has to say `/private/var/folders/...`.

**Removal criterion.** The entry earns its place only because some tools ignore `TMPDIR`. The `xcrun` shims call `confstr(_CS_DARWIN_USER_TEMP_DIR)` and write `xcrun_db-*` under `/var/folders/<hash>/<hash>/T` whatever the environment says, which is how a sandboxed `strings` fails today. Drop the entry once a sandboxed `strings` on any Mach-O binary stops touching `/var/folders`.

## `/dev/fd` and Process Substitution

The `/dev/fd` entry in `allowWrite` is inert, and no path-based rule can replace it. `diff <(echo a) <(echo b)` fails with `Operation not permitted` on `/dev/fd/<n>` under a `sandbox-exec` profile that allows `(subpath "/dev/fd")`, and also under one that allows `(subpath "/dev")`, while an unfiltered `(allow file-write*)` passes. The kernel resolves `/dev/fd/<n>` to the underlying pipe, which has no filesystem path for a `subpath` or `regex` filter to match. Process substitution stays broken under the sandbox until upstream changes how the write profile is built. The entry is still listed in `user/settings.json`, and dropping it is a separate change.

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

Allowlisting those hosts is necessary but not sufficient. The sandbox blocks Node's `dns.lookup` for every host including allowlisted ones, so a plain `greptile whoami` fails `ENOTFOUND` before the allowlist is consulted. `NODE_USE_ENV_PROXY=1` in `env` is what makes both CLIs work: Node 24 honors the `HTTPS_PROXY` the sandbox already exports, and that proxy enforces the same host allowlist. It is inert outside the sandbox and below Node 24.

**Removal criterion.** Drop it when a sandboxed `greptile whoami` succeeds without it, which is the same probe that catches the harness or Node fixing DNS under Seatbelt:

```
env -u NODE_USE_ENV_PROXY greptile whoami
```

### Sockets and Writes

Treat this section as a trust model, not an exhaustive mirror of `settings.json`.

- `allowUnixSockets` should be local IPC endpoints where secret material never leaves a dedicated agent (for example, signing daemons or the tmux and herdr sockets). The multiplexer sockets (tmux, herdr) can inject keys into other panes, so they are command execution by another name. Accepted so layout, agent, and notification commands run sandboxed rather than escaped.
- `allowLocalBinding` should stay loopback-only.
- `filesystem.allowWrite` should allow only scratch/cache/worktree paths that tools must mutate, and never credential stores or broad home-directory globs. Two paths are deliberate exceptions to the credential-store clause, `~/.greptile` and `~/.local/share/atuin`.
- `~/.greptile` holds the CLI's `auth.json` beside its `reviews.json` log, and `greptile review` writes both on every run. The grant covers the directory because the CLI chmods it, which a file-level grant leaves failing at `EPERM`. Accepted so `greptile review` runs sandboxed rather than escaped, the same trade as the `*.greptile.com` egress entry above. The added risk is tampering with a token that is already exfiltrable. **Removal criterion:** narrow it back to `~/.greptile/reviews.json` once a sandboxed `greptile review` stops dying on the directory `chmod`.
- `~/.local/share/atuin`: the dir holds atuin's sync encryption key and the session tokens in `meta.db`. Atuin opens `meta.db` read-write on every command, including the history reads behind the `atuin:history` skill, and SQLite creates journal and WAL files beside its dbs, so a file-level grant would fail intermittently. The sandbox grants no egress to atuin's sync hosts, so the risk is local tampering: a swapped key or token would first reach the network through a later unsandboxed `atuin sync`.

### Escaped Commands (`excludedCommands`)

Run outside the sandbox; only the top-level command matches (see [Sandbox and Nested Commands](#sandbox-and-nested-commands)).

- Self-authenticating network tools: `git`, `linear`, `aws`, `gcloud`, `az`, `pulumi`, `ssh`, `scp`, `rsync`, `docker`. Each carries its own auth and already reaches the network.
- macOS host integration (`mac` plugin): `open`, `osascript`, `shortcuts`, `pbcopy`, `pbpaste`, `security`, `defaults`, `screencapture`, `say`, `afplay`, `diskutil`, `networksetup`, `dscl`. Host APIs the sandbox cannot model.
- Local session tooling: `wt`, `claude`, `agent-browser`, `code`. Worktree, session, and editor control that stays local.

A new host needs its secret kept outside the sandbox, and never add an upload-capable one casually. A new escaped command must fit a group above. If it reaches the network without its own auth, keep it sandboxed.
