# settings.json Entries

Why each sandbox grant and hook in `settings.json` exists and what would retire it. Nothing here auto-injects. [`.claude/rules/settings.md`](../.claude/rules/settings.md) carries the rules that govern an edit and links here.

## Hosts

`WebFetch(domain:...)` permissions, granted in `user/settings.json` unless noted.

- Package registries: `registry.npmjs.org`, `www.npmjs.com`, `pypi.org`, `rubygems.org`, `proxy.golang.org`, `sum.golang.org`, `community-extensions.duckdb.org` (the DuckDB `markdown` and `yaml` extensions, fetched on first `INSTALL ... FROM community`).
- Docs and source: `platform.claude.com`, `code.claude.com`, `modelcontextprotocol.io`, `pkg.go.dev`, `bun.sh`, `bun.com`, `github.com`, `raw.githubusercontent.com`.
- Credentialed APIs: `api.github.com`, `api.linear.app`, `api.anthropic.com`, `claude.ai`, `gitlab.com`, `*.greptile.com`, `*.coderabbit.ai`.

`api.anthropic.com` accepts uploads and is the known exfil-capable host. It stays because the agent needs the model API.

`gitlab.com`, `*.greptile.com`, and `*.coderabbit.ai` are exceptions to the secrets-outside-the-sandbox rule. `glab`, `greptile`, and `coderabbit` each keep an OAuth token in a sandbox-readable file (`~/.config/glab-cli/config.yml`, `~/.greptile/auth.json`, `~/.coderabbit/auth.json`), and all three hosts accept uploads, so the token is exfiltrable through any allowlisted host. Granted so the CLIs run sandboxed rather than escaped, which was the alternative for every `glab` call.

`docs.anthropic.com` is the legacy host that 301-redirects to `code.claude.com`. The grant buys only the first leg of the redirect. **Drop it** when this stops returning a 3xx to a host already listed:

```
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://docs.anthropic.com/en/docs/claude-code/settings
```

`www.schemastore.org` is granted in `.claude/settings.json` instead, because only this repo fetches it, through `schemas/overlays/sources.json`. It is unauthenticated and read-only. **Drop it** when no overlay resolves its base live, which happens only if the upstream-backed schemas become hand-authored or vendored. See [`schemas.md`](../.claude/rules/schemas.md).

```
jq -r '.schemas[].url' schemas/overlays/sources.json | grep schemastore.org
```

An allowlist entry alone is not enough for a Node CLI. The sandbox blocks Node's `dns.lookup` for every host, so a plain `greptile whoami` fails `ENOTFOUND` before the allowlist is consulted. `NODE_USE_ENV_PROXY=1` in `env` is what makes it work: Node 24 honors the `HTTPS_PROXY` the sandbox already exports, and that proxy enforces the same allowlist. It is inert outside the sandbox and below Node 24. **Drop it** when this succeeds:

```
env -u NODE_USE_ENV_PROXY greptile whoami
```

## Write Paths

`filesystem.allowWrite` takes scratch, cache, and worktree paths that tools must mutate, never credential stores or broad home-directory globs. Each entry below was denied in practice first, surfacing as a bare `Operation not permitted` that named neither the sandbox nor the rule.

Three grants are deliberate exceptions to the credential-store clause. Each holds a token beside state the CLI rewrites on every run, so a file-level grant fails:

- `~/.greptile`: `auth.json` beside `reviews.json`, both written by `greptile review`. The grant covers the directory because the CLI chmods it, which a file-level grant leaves failing at `EPERM`. The added risk is tampering with a token already exfiltrable through the egress grant above. **Narrow it** to `~/.greptile/reviews.json` once a sandboxed `greptile review` stops dying on the directory `chmod`.
- `~/.coderabbit`: `auth.json` beside local state. Without it `coderabbit doctor` reports `[fail] Storage` and a review hangs for many minutes before dying rather than failing fast. **Drop it** when `pull-request:follow-up --local` no longer runs the CLI.
- `~/.local/share/atuin`: the sync encryption key and session tokens in `meta.db`, which atuin opens read-write on every command, including the history reads behind the `atuin:history` skill. SQLite writes journal and WAL files beside it, so a file-level grant fails intermittently. The sandbox grants no egress to atuin's sync hosts, so the risk is local tampering, reaching the network only through a later unsandboxed `atuin sync`.

`~/.herdr/worktrees` covers deleting a worktree rather than working in one. The session's own worktree is already writable through the sandbox's `.` entry, and removing a *different* one is what fails. `git worktree remove` checks for uncommitted changes, deregisters the admin entry, and only then deletes the files. A denied delete then orphans the directory: absent from `git worktree list`, no admin entry, and beyond git's reach. That happened twice on 2026-09-05, once through `gh pr merge --delete-branch`, which left 2.6 GB behind. **Drop it** when herdr stops placing worktrees under `~/.herdr`.

The rest are tool caches and state directories holding no credential material:

- `~/.duckdb`: extensions installed on first `INSTALL ... FROM community`. Without it the `claude-code:session` skill dies on `IO Error: Failed to create directory`, having already been granted the egress to fetch them. The version in the path changes with each DuckDB release, so a fresh install re-denies. **Drop it** when no skill queries DuckDB with a community extension.
- `~/.local/share/plannotator`: annotation history, drafts, and the feedback archive, rewritten on every run. Without it each save fails `EPERM`, and a review runs with no version diffs and no recovery copy. **Drop it** when no skill drives the `plannotator` CLI.
- `~/.agent-browser`: the CLI's control socket. `agent-browser` sits in `excludedCommands`, but only a top-level match escapes, so a skill script that shells out to it runs sandboxed and fails with `Socket directory is not writable`. Another `excludedCommands` entry would not help. **Drop it** when the `agent-browser` skill stops invoking the CLI from a wrapper.
- `~/Library/Caches/ms-playwright`: Playwright's unpacked browser builds. Without it an install fails at `mkdir` before reaching the download, which reads as a network problem. **Drop it** when no skill or work repo drives Playwright.
- `~/.gradle` and `~/.config/jgit`: the Gradle wrapper's distribution lock and jgit's config lock, both written by Java builds in work repos. This fixes the filesystem half only, and a Gradle build that reaches the network still needs a full skip. **Drop both** when no Java repo is in rotation, and revisit if the egress half is ever granted, since the pair only pays off together.
- `~/.claude/plans`: saved plan files, which copying one in fails without. No injected deny shadows it, unlike the `~/.claude` paths below. Permanent unless plan files move out of `~/.claude`.

## Sockets and Local Binding

`allowUnixSockets` takes local IPC endpoints where secret material never leaves a dedicated agent: signing daemons, and the tmux and herdr sockets. The multiplexer sockets can inject keys into other panes, so they are command execution by another name. Accepted so layout, agent, and notification commands run sandboxed rather than escaped.

`allowLocalBinding` stays loopback-only.

## Escaped Commands

`excludedCommands` entries run outside the sandbox, and only the top-level command of an invocation matches.

- Self-authenticating network tools: `git`, `linear`, `aws`, `gcloud`, `az`, `pulumi`, `ssh`, `scp`, `rsync`, `docker`. Each carries its own auth and already reaches the network.
- macOS host integration (`mac` plugin): `open`, `osascript`, `shortcuts`, `pbcopy`, `pbpaste`, `security`, `defaults`, `screencapture`, `say`, `afplay`, `diskutil`, `networksetup`, `dscl`. Host APIs the sandbox cannot model.
- Local session tooling: `wt`, `claude`, `agent-browser`, `code`. Worktree, session, and editor control that stays local.

A new host needs its secret kept outside the sandbox, and never add an upload-capable one casually. A new escaped command must fit a group above. If it reaches the network without its own auth, keep it sandboxed.

Go CLIs need no entry. `sandbox.network.allowMachLookup` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification profile-wide.

## Hooks

Why a hook entry in `user/settings.json` earns its place, and what would retire it, for the entries that ship no `README.md` of their own. The hook scripts live in [`user/hooks/`](../user/hooks).

[`agent-model`](../user/hooks/agent-model) warns, on a `PreToolUse` matching `Agent`, when a spawn names neither a `model` nor a `subagent_type` that pins one and the parent is running opus or fable. It enforces the delegation rule already written in `user/CLAUDE.md`, which spawns were ignoring: over the 30 days to 2026-09-01, 34 `general-purpose` and 30 bare spawns under opus-family parents carried no `model` and resolved to opus, and their task descriptions were lookup and fan-out shaped. It emits `additionalContext` and no `permissionDecision`, so the spawn still proceeds. `PreToolUse` carries no model field, so the parent's family comes from the last assistant record in the tail of `transcript_path`, and an unresolvable model stays silent.

**Delete it** if the gap it targets has not closed. Around 2026-10-15, run the `claude-code:session` skill's [`delegation`](../plugins/claude-code/skills/session/resources/queries/delegation.sql) query with `host` set to `local` and `after_date` to the day this shipped, and read the `generic` path under an opus or fable `parent_family`. If `cheaper_override_rate_pct` has not risen and the count of spawns carrying no override has not fallen, the warning is not changing behavior and the hook goes.

## Sandbox Findings

Mechanism behind the rules in [`settings.md`](../.claude/rules/settings.md), and the cases no setting can fix.

#### Write Denies Shadow Allows

The write profile emits every `allowOnly` rule before every `denyWithinAllow` rule, and Seatbelt takes the last matching rule, so a broad deny always beats a narrower allow no matter how specific. The read profile implements `allowWithinDeny` and has no such trap, and the [sandboxing docs](https://code.claude.com/docs/en/sandboxing) state the specificity rule only for reads. Confirmed with `sandbox-exec`: given a deny of a parent and an allow of a child, emitting the allow first denies the child, and emitting it last permits the child while the rest of the parent stays denied. The fix belongs upstream.

Three paths hit this:

- `~/.claude/plugins`. `~/.claude/plugins/data` sat in `allowWrite` for a while and never took effect.
- `~/.claude/jobs`. The harness tells background-job sessions to write under `$CLAUDE_JOB_DIR/tmp` and injects the deny itself, so `user/settings.json` cannot narrow it. Jobs fall back to `$TMPDIR`, losing the per-job isolation the directory was meant to provide.
- `~/.claude/projects`, holding the per-project memory directories. Only Bash runs under Seatbelt, so a `Write` from the tool layer lands while `rm` or `cp` on the same file returns `Operation not permitted`. Auto mode routing file edits through Bash is what makes the gap reachable so often. Verified inert against Claude Code 2.1.232.

The four session-index writers carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker to work around this, trading real sandbox coverage for a working toolchain. **Drop the markers** when this probe succeeds under the sandbox:

```
touch ~/.claude/plugins/data/.sandbox-probe && rm ~/.claude/plugins/data/.sandbox-probe
```

Do not wait for an upstream announcement. [#41156](https://github.com/anthropics/claude-code/issues/41156) raised the same conflict at the permission-prompt layer and was closed `NOT_PLANNED` by a staleness bot. Related: [#51973](https://github.com/anthropics/claude-code/issues/51973), [#34900](https://github.com/anthropics/claude-code/issues/34900).

#### Path Globs

An entry with no glob character becomes a Seatbelt `(subpath ...)` rule covering everything beneath it. An entry containing `*`, `?`, `[`, or `]` becomes a `(regex ...)` rule anchored at both ends, matching that one path and nothing inside it. `/var/folders/*/*/T` granted the temp directory itself while every `mktemp` inside it failed.

A trailing `/**` does not fix that, because the harness strips `/**` off the end of every sandbox path before building the profile. That is what turns a plain `/foo/**` into the recursive `(subpath "/foo")`, and what turns `/var/folders/*/*/T/**` back into the anchored regex. `/**/*` survives the strip and compiles to `(.*/)?[^/]*`, matching any depth. `/*` reaches direct children only.

Verified against Claude Code 2.1.232 with nested `claude --settings <file> -p` runs: the bare glob and `/**` both failed `touch <tmpdir>/probe`, `/*` failed one level deeper, and `/**/*` passed `touch`, nested `mkdir`, `mktemp`, and `mktemp -d`. `sandbox-exec` on hand-written profiles confirmed the underlying rule semantics.

Seatbelt matches resolved paths, so a rule spelled `/var/...` matches nothing on macOS. The harness realpaths the literal prefix of each entry before emitting it, which is why `/var/folders/...` works in settings while a hand-written probe profile needs `/private/var/folders/...`.

`/var/folders/*/*/T/**/*` earns its place only because some tools ignore `TMPDIR`. The `xcrun` shims call `confstr(_CS_DARWIN_USER_TEMP_DIR)` and write `xcrun_db-*` there whatever the environment says, which is how a sandboxed `strings` fails today. **Drop it** once a sandboxed `strings` on a Mach-O binary stops touching `/var/folders`.

#### Bare `/tmp`

The `/tmp` entry does not grant `/tmp` itself. A `mkdir` directly in `/tmp` returns `Operation not permitted`, while `/tmp/claude` and the session scratchpad under `/tmp/claude-<uid>` both accept writes, so temp files belong in a repo's `tmp/` or the scratchpad. This contradicts the global CLAUDE.md line saying the sandbox can write `/tmp`, which should be fixed. The `$TMPDIR` half of that line holds, though not for the reason the `env` block suggests: `env` sets `TMPDIR=/tmp` and the harness overrides it per session to the scratchpad. The mechanism behind the denial is unconfirmed, and it is not the precedence trap above, since a deny covering `/tmp` would take `/tmp/claude` with it.

#### `/dev/fd`

The `/dev/fd` entry is inert, and no path-based rule can replace it. `diff <(echo a) <(echo b)` fails with `Operation not permitted` on `/dev/fd/<n>` under a `sandbox-exec` profile allowing `(subpath "/dev/fd")`, and under one allowing `(subpath "/dev")`, while an unfiltered `(allow file-write*)` passes. The kernel resolves `/dev/fd/<n>` to the underlying pipe, which has no filesystem path for a `subpath` or `regex` filter to match. Process substitution stays broken until upstream changes how the write profile is built. Removing the entry is a separate change.

## Auto Mode Findings

`useAutoModeDuringPlan` needs no entry. It defaults on as of v2.1.218 and routes plan-mode shell commands through the classifier instead of prompting them. The gate is that auto mode is *available* to the account, so it is not a reason to set `defaultMode`. The settings schema muddies this by saying the key "has no effect unless `permissions.defaultMode` allows auto", which reads as a requirement that the active mode be `auto`.

Classifier denials reach no durable surface on their own. The [`permission-denied`](../user/hooks/permission-denied) hook logs them so the `autoMode` rules stay measurable.
