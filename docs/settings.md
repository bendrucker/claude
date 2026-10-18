# settings.json Entries

Why each sandbox grant and hook in `settings.json` exists and what would retire it. Nothing here auto-injects. [`.claude/rules/settings.md`](../.claude/rules/settings.md) carries the rules that govern an edit and links here.

## Hosts

Sandbox entries live in `user/settings.json` and `WebFetch` grants in `managed/settings.json` unless noted. `sandbox.network.allowedDomains` opens a host to sandboxed Bash. A `WebFetch(domain:...)` permission lets the `WebFetch` tool fetch it without a prompt, and the sandbox also admits it. A host gets a `WebFetch` entry only when the session index shows the tool fetching it, and an `allowedDomains` entry when a CLI reaches it.

- Package registries: `registry.npmjs.org` and `pypi.org` (both), `www.npmjs.com` (`WebFetch`), `rubygems.org`, `proxy.golang.org`, `sum.golang.org`, `bun.sh` (`allowedDomains`), and `community-extensions.duckdb.org` (both, the DuckDB `markdown` and `yaml` extensions, fetched on first `INSTALL ... FROM community`).
- Docs: `platform.claude.com`, `code.claude.com`, `modelcontextprotocol.io`, `pkg.go.dev`, `bun.com` (`WebFetch`).
- Source and credentialed APIs, `WebFetch` and `allowedDomains` both: `github.com`, `raw.githubusercontent.com`, `api.github.com`, `gitlab.com`, `claude.ai`, `*.greptile.com`, `*.coderabbit.ai`.
- Credentialed APIs no tool fetches, `allowedDomains` only: `api.individual.githubcopilot.com`, `api.linear.app`, `api.anthropic.com`, `api.cloudflare.com`, `dash.cloudflare.com`.

`auth.docker.io` (`allowedDomains`) is Docker Hub's token endpoint. `docker pull` and `docker run` fetch images from inside the Docker Desktop VM, outside the sandbox proxy, so they don't need a host. `docker buildx build` is different. The CLI answers BuildKit's auth callback itself, so a sandboxed build from a Docker Hub base image fails `failed to fetch oauth token: Post "https://auth.docker.io/token": Forbidden`. The host exchanges credentials for pull tokens and doesn't accept uploads. A base image already in the local cache doesn't trigger an auth request, so `ghcr.io` stays ungranted. Add it if a sandboxed build of an uncached GHCR image is denied. **Drop it** alongside the Docker socket.

`gh` redirects some downloads to hosts outside `api.github.com`. `gh run view --log` and `--log-failed` fetch from `results-receiver.actions.githubusercontent.com`, and `gh release download` from `release-assets.githubusercontent.com`. Both serve signed, short-lived URLs that `api.github.com` hands out. `gh run download` fetches artifacts from Azure storage accounts named `productionresultssa<n>.blob.core.windows.net`, so it needs `*.blob.core.windows.net`. That wildcard is exfil-capable: anyone can create a storage account under it and hand out a writable SAS URL. It is granted so artifact downloads run sandboxed. **Narrow it** if GitHub moves artifacts behind a `githubusercontent.com` host. **Drop it** if no session downloads run artifacts. Without it `gh run download` fails at the proxy while `gh run view --log` still works.

`registry.terraform.io` and `releases.hashicorp.com` let a sandboxed `terraform init` resolve and download public providers. `files.pythonhosted.org` serves the wheels that `pypi.org` indexes, so `pip download` and `pip install` fail without it even with `pypi.org` granted. All three are read-only distribution hosts. **Drop the Terraform pair** when no repo in rotation runs `terraform init` sandboxed.

`api.anthropic.com` accepts uploads and is the known exfil-capable host. It stays because the agent needs the model API.

`gitlab.com`, `*.greptile.com`, and `*.coderabbit.ai` are exceptions to the secrets-outside-the-sandbox rule. `glab`, `greptile`, and `coderabbit` each keep an OAuth token in a sandbox-readable file (`~/.config/glab-cli/config.yml`, `~/.greptile/auth.json`, `~/.coderabbit/auth.json`), and all three hosts accept uploads, so the token is exfiltrable through any allowlisted host. Granted so the CLIs run sandboxed rather than escaped, which was the alternative for every `glab` call.

`api.cloudflare.com` and `dash.cloudflare.com` are the same exception for `wrangler`, whose OAuth login sits in `~/.config/.wrangler/config/default.toml`. `api.cloudflare.com` serves every API call and accepts uploads (deploys, D1 writes, R2). `dash.cloudflare.com` serves only the token refresh at `/oauth2/token`. The access token lasts an hour, so without the refresh host any sandboxed `wrangler` call past that hour fails as not logged in. `sparrow.cloudflare.com` is wrangler's telemetry and stays denied, which wrangler tolerates. The refresh host depends on the `~/.config/.wrangler/config` write grant below. **Drop both** when no repo in rotation deploys to Cloudflare.

`oidc.us-east-1.amazonaws.com`, `portal.sso.us-east-1.amazonaws.com`, and `sts.us-east-1.amazonaws.com` (`allowedDomains`) let a sandboxed `aws --profile` call authenticate: SSO token refresh, role credentials from the SSO portal, and STS for identity checks and chained roles. Another SSO or STS region needs its own hosts. `aws:*` doesn't cover these calls, because Claude Code drops the escape from any `aws` command that passes `--profile`, likely since a profile can name a `credential_process`. Without the hosts the call fails `Failed to connect to proxy URL` at `oidc`. Any AWS endpoint accepts requests signed by any account, so these hosts carry small payloads (an assume-role session name) to an attacker who supplies their own keys. The bulk-capable hosts (`ec2`, `ssm`, `ssmmessages`, S3) stay denied. `vm` runs escaped instead, below. The hosts depend on the `~/.aws` write grants below. **Drop all three** when no sandboxed command uses an AWS profile. After removal `aws sts get-caller-identity --profile <name> | cat` fails at `oidc` again.

`api.individual.githubcopilot.com` is the Copilot CLI's model API, which the `github:copilot` skill's `review.ts` drives sandboxed. Without it every run dies at startup with `Failed to load models`. It receives the diff under review, so it accepts uploads, and the token it takes is the same `gh` login the sandbox can already read. `telemetry.individual.githubcopilot.com` stays denied, which Copilot tolerates. An `individual` host serves only Copilot Individual plans, so a Business or Enterprise login reaches a different subdomain. **Drop it** when no skill runs `copilot` sandboxed. This probe fails before inference at zero credits, and it passes when it prints `Model "no-such-model-probe" ... is not available`:

```
COPILOT_GITHUB_TOKEN=$(gh auth token) HOME=~/.cache/claude/copilot-home copilot --model no-such-model-probe -p ok
```

`docs.anthropic.com` (`WebFetch`) is the legacy host that 301-redirects to `code.claude.com`. The grant buys only the first leg of the redirect. **Drop it** when this stops returning a 3xx to a host already listed:

```
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://docs.anthropic.com/en/docs/claude-code/settings
```

`www.schemastore.org` (both) is granted in `.claude/settings.json` instead, because only this repo fetches it, through `schemas/overlays/sources.json`. It is unauthenticated and read-only. **Drop it** when no overlay resolves its base live, which happens only if the upstream-backed schemas become hand-authored or vendored. See [`schemas.md`](../.claude/rules/schemas.md).

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

`~/.config/.wrangler/config` is a fourth exception: it holds `default.toml`, the `wrangler` OAuth access and refresh tokens, which wrangler rewrites on each hourly refresh. Cloudflare rotates the refresh token when it issues a new access token, and wrangler writes the pair back only after the exchange succeeds. A denied write-back therefore burns the only stored refresh token. Every later call then gets a `400` from the token endpoint, including unsandboxed ones, until an interactive `wrangler login`. Granting `dash.cloudflare.com` without this directory is worse than granting neither: with the host denied the refresh never reaches Cloudflare, so an unsandboxed call still works. Grant, narrow, or drop the host and this path together. The grant covers the directory because named auth profiles write their own files beside `default.toml`. The token is already exfiltrable through the Cloudflare hosts above. **Drop it** alongside those hosts.

`~/.aws/cli/cache` and `~/.aws/sso/cache` are two more credential-store exceptions, paired with the AWS hosts above. `cli/cache` holds role credentials the CLI fetches from the SSO portal, and a sandboxed `aws --profile` call fails `Operation not permitted` on its cache file without it. `sso/cache` holds the SSO access and refresh tokens, which the CLI rewrites when it refreshes an expired access token through `oidc`. It is granted ahead of a denial: a denied write-back after a successful refresh may strand the session until `aws sso login`, as it does for `wrangler`, so the host and this path go together. The tokens are already readable and usable through the granted hosts, so the added risk is tampering. **Drop both** alongside the three AWS hosts.

`~/.config/glab-cli` is another exception. It holds `config.yml` with the GitLab OAuth token, which `glab` rewrites through a temp file beside it on every call, `glab config get` included. A file-level grant fails on the temp file, and the earlier `~/.config/glab-cli/recover` grant left every call printing a `.config.yml<random>` write error. The token is already exfiltrable through `gitlab.com`, so the added risk is tampering. **Drop it** alongside `gitlab.com`.

`~/src/.worktrees` and `~/src/*/*/.worktrees/**/*` let a session write to worktrees outside its own tree: a sibling session's worktree under Worktrunk's shared root, and repo-local worktrees under `<repo>/.worktrees`, where `WORKTRUNK_WORKTREE_PATH` puts them. The second entry is a glob so the repository root beside `.worktrees` stays denied. `.git/config` stays denied inside both, per [Shared `.git/config`](#shared-gitconfig). **Drop either** when Worktrunk stops placing worktrees there.

`~/.herdr/worktrees` covers deleting a worktree rather than working in one. The session's own worktree is already writable through the sandbox's `.` entry, and removing a *different* one is what fails. `git worktree remove` checks for uncommitted changes, deregisters the admin entry, and only then deletes the files. A denied delete then orphans the directory: absent from `git worktree list`, no admin entry, and beyond git's reach. That happened twice on 2026-09-05, once through `gh pr merge --delete-branch`, which left 2.6 GB behind. **Drop it** when herdr stops placing worktrees under `~/.herdr`.

The rest are tool caches and state directories holding no credential material:

- `~/.duckdb`: extensions installed on first `INSTALL ... FROM community`. Without it the `observability:session` skill dies on `IO Error: Failed to create directory`, having already been granted the egress to fetch them. The version in the path changes with each DuckDB release, so a fresh install re-denies. **Drop it** when no skill queries DuckDB with a community extension.
- `~/.plannotator`: annotation history, drafts, config, and the feedback archive, rewritten on every run. plannotator uses `PLANNOTATOR_DATA_DIR` when set, then `~/.plannotator` if it exists, and only then `$XDG_DATA_HOME/plannotator`, so the legacy directory wins on this machine. Without it each save fails `EPERM`, and a review runs with no version diffs and no recovery copy. **Drop it** when no skill drives the `plannotator` CLI, and move it if the data directory moves.
- `~/.agent-browser`: the CLI's control socket. `agent-browser` sits in `excludedCommands`, but a match has to sit in the invocation's own chain, so a skill script that shells out to it runs sandboxed and fails with `Socket directory is not writable`. Another `excludedCommands` entry would not help. **Drop it** when the `agent-browser` skill stops invoking the CLI from a wrapper.
- `~/Library/Caches/ms-playwright`: Playwright's unpacked browser builds. Without it an install fails at `mkdir` before reaching the download, which reads as a network problem. **Drop it** when no skill or work repo drives Playwright.
- `~/.gradle` and `~/.config/jgit`: the Gradle wrapper's distribution lock and jgit's config lock, both written by Java builds in work repos. This fixes the filesystem half only, and a Gradle build that reaches the network still needs a full skip. **Drop both** when no Java repo is in rotation, and revisit if the egress half is ever granted, since the pair only pays off together.
- `~/.config/.wrangler/logs` and `~/.config/.wrangler/registry`: per-run debug logs and the local dev registry for `wrangler dev` cross-worker bindings. Without the logs grant every invocation prints an `EPERM` error before running. **Drop both** alongside the Cloudflare hosts.
- `~/.local/state/vm`: the `vm` launcher's per-VM SSH config entry, `known_hosts`, JSON record, and ControlMaster sockets, kept apart from `~/.ssh` so sandboxed `ssh vm-NAME` calls (piped or chained, which miss the `ssh` and `vm` escapes) reach VMs without a grant there. It holds no private keys, which stay in Secretive. The directory is also in `allowUnixSockets`, below. **Drop both** when `vm` moves its state or no session runs `ssh` to a VM in a pipeline.
- `~/.docker/buildx`: buildx's per-builder activity timestamps and build refs, written on every build. Without it `docker buildx build` fails `failed to update builder last activity time: ... operation not permitted` before the build starts. The rest of `~/.docker`, including `config.json`, stays read-only. `instances/` would hold remote builder definitions and their TLS paths, so a write could repoint the default builder. It is empty here, and the socket already grants more. **Drop it** alongside the Docker socket.
- `~/.local/state/nvim`: Neovim's ShaDa file, swap, and undo state. Without it a headless `nvim` exits with `E886: Can't rename ShaDa file`. **Drop it** when no session runs `nvim` sandboxed.
- `~/Library/Caches/golangci-lint`: the analysis cache. Without it `golangci-lint run` warns on every facts-cache write and reanalyzes from scratch. **Drop it** when no Go repo is in rotation.
- `~/Library/Caches/com.apple.python`: where Apple's `/usr/bin/python3` writes bytecode, through a `pycache_prefix` it sets itself. Without it each import of a script under the session tree fails its `.pyc` write. Setting `PYTHONPYCACHEPREFIX` in `env` cannot replace this, because `env` values are not expanded and the path needs the home directory. **Drop it** when no script runs under the system Python.
- `~/.claude/plans`: saved plan files, which copying one in fails without. No injected deny shadows it, unlike the `~/.claude` paths below. Permanent unless plan files move out of `~/.claude`.

## Sockets and Local Binding

`allowUnixSockets` takes local IPC endpoints where secret material never leaves a dedicated agent: signing daemons, and the herdr socket. The herdr socket can inject keys into other panes, so it is command execution by another name. Accepted so layout and agent commands run sandboxed rather than escaped. `~/.local/state/vm` holds `vm`'s ControlMaster sockets, named by `%C` hash, so the entry names the directory: each entry becomes a `subpath` rule. Without it ssh fails `Control socket connect(...): Operation not permitted`. An open master runs commands on its VM without re-authenticating, the same reach as the herdr socket but confined to VMs this session could already launch.

`~/.docker/run/docker.sock`, Docker Desktop's API socket behind the `desktop-linux` context, is the exception to the rule above: the daemon is a full sandbox escape. A container can mount any shared host path and reaches the network from the Docker Desktop VM, outside the egress proxy. `docker` is not in `excludedCommands`, so the socket is how every `docker` call reaches the daemon, and it hands that power to any sandboxed process: `docker ... | tail`, `cd <dir> && docker build`, wrappers like `lazydocker`, `dive`, and Makefiles, and anything else that opens the socket. Without it the CLI fails `permission denied while trying to connect to the docker API`. The `~/.docker/buildx` write grant and the `auth.docker.io` host exist only so builds work through this socket. `/var/run/docker.sock` is a symlink to it that serves only the unused `default` context, so it stays ungranted. `docker-proxy.sock` and the OTLP analytics socket stay denied. **Drop it** when no sandboxed command uses `docker`. After removal a sandboxed `docker ps | cat` prints `permission denied`.

Node tools that open IPC pipes under `$TMPDIR`, such as `tsx`, need a socket grant on the session temp root. The harness sets `TMPDIR` to `/tmp/claude-<uid>`, so the entry depends on the user ID and lives in the user-tier `~/.claude/settings.local.json` instead. Only the literal path works. `$TMPDIR` is not expanded, and `/tmp/claude-*` and `/tmp/claude-*/**/*` don't match the pipe. The `/private/tmp` write grant does not cover sockets. `allowAllUnixSockets` would work, but it opens every socket on the machine. Without the entry `tsx` fails `listen EPERM` on `tsx-<uid>/<pid>.pipe`. **Move it** to `user/settings.json` if the harness starts expanding variables or globs in socket entries.

`allowLocalBinding` stays loopback-only.

## Escaped Commands

`excludedCommands` entries run outside the sandbox. An invocation escapes only when every command in its chain matches an entry, pipeline members included, so `git push -u origin HEAD 2>&1 | tail` and `git config ... && echo` both run sandboxed because `tail` and `echo` match nothing. A global option before the subcommand misses too, so the `git` plugin's HTTPS push fallback (`git -c credential.helper=... push`) runs sandboxed. The escape outranks the `filesystem` denies, so an entry grants far more than the one verb it names. `git:*` means any invocation made only of `git` commands writes anywhere on disk. Judge a candidate on that reach.

An entry earns its place globally only when sandboxed runs of the command fail across many projects. Over the 90 days to 2026-10-18 on the Studio, sandboxed runs of most excluded commands failed on sandbox errors no more often than escaped runs did, so the global list keeps six:

- `git`: 11.7k escaped calls across 62 projects. Sandboxed, it fails where the sandbox protects `.git/config` (`push -u`, `fetch`, `branch` lock the config) and `.claude/` (`worktree add`, `rebase`, and `merge` writing tracked files there), and on the keychain credential helper. Those are too many subcommands to list one by one.
- `wt`, `claude`: worktree and session control across 20 and 3 projects. `wt` creates worktrees outside the session directory.
- `agent-browser`: 742 escaped calls across 8 projects. The escape lets the daemon launch Chrome off the egress proxy, which an arbitrary page needs.
- `open`, `osascript`: Apple Events and Launch Services handoff, which the sandbox cannot model even with `allowAppleEvents`. Used across 13 and 3 projects.

A command one or two projects use goes in that project's `.claude/settings.json`, and scopes combine. This repo's settings carry `ssh`, `scp`, `rsync`, `vm`, and `aws`, which its VM and eval-bucket work needs. `aws` escapes only without `--profile` (see the AWS hosts above). `vm`, the EC2 launcher in dotfiles, shells out to `aws --profile` against `ec2`, `ssm`, and `ssmmessages`, and to `ssh` through Session Manager. Escaping it keeps those hosts out of the allowlist. Piped, `vm list | cat` runs sandboxed and reports each kind as skipped at `ec2`. A work repo's entries live in its own checkout, never here.

`docker` and `linear` run sandboxed: the Docker socket grant above already covers the daemon, and `api.linear.app` is allowlisted. The other host commands (`shortcuts`, `pbcopy`, `pbpaste`, `security`, `defaults`, `screencapture`, `say`, `afplay`, `diskutil`, `networksetup`, `dscl`, `gcloud`, `az`, `code`) escaped fewer than five times each in that window, so a rare call takes the unsandboxed retry. **Re-add one globally** when the `sandbox-bypass-effective-command` query ranks it among the top bypassed verbs across several projects.

A new host needs its secret kept outside the sandbox, and never add an upload-capable one casually. A new escaped command must carry its own auth, and if it reaches the network without its own auth, keep it sandboxed.

Go CLIs need no entry. `sandbox.network.allowMachLookup` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification profile-wide.

`com.apple.nehelper` and `com.apple.nesessionmanager` let the standalone Tailscale app's CLI load its NetworkExtension configuration. Without them every `tailscale` command exits `Failed to load preferences`, which breaks `plannotator --tailscale`. Past that, the CLI reaches the daemon's local API over loopback TCP at the port `/Library/Tailscale/ipnport` names, authenticated by the `sameuserproof-<port>` token beside it. `allowLocalBinding` and default reads cover both. `nesessionmanager` can start and stop VPN sessions, the same reach `tailscale up` and `down` already have through the local API. **Drop both** when no skill drives `tailscale` sandboxed.

## Environment

The `env` block exports into every session. `NODE_USE_ENV_PROXY` is covered under Hosts.

`CLAUDE_CODE_SUBAGENT_MODEL=opus` is the model for a spawn with no `model` at the call site and none in the agent's frontmatter. Explicit params, pinned agents, and `model: inherit` (the built-in `Plan`, [`review:review`](../plugins/review/agents/review.md)) all rank above it. The target is a Fable parent, where a bare `general-purpose` spawn otherwise inherits Fable: 150 did over July and August 2026, and the 35 implementation agents among them would have done the same work on Opus at half the rate. `general-purpose` is the fallback for implementation work, so Opus is the intended model there. Under a Sonnet or Haiku parent it upgrades a bare spawn to Opus, which the `delegation` query shows as an `opus` `actual_family` under a cheaper parent. `Explore` already carries this cap in the CLI binary.

**Drop it** when a later CLI caps `general-purpose` under Fable natively.

`AGENT_BROWSER_IDLE_TIMEOUT_MS=600000` stops an `agent-browser` daemon and its Chrome after 10 idle minutes, down from the CLI's one hour. A subagent that ends or is stopped without running `close` leaves its daemon behind, and a fan-out of browser-driving subagents once left ten of them holding 8.8 GiB. The daemon takes the timeout from the environment of the command that launched it, so it covers every launch from a Claude session and none from a shell. Only Claude drives the CLI here. It is working while every session `agent-browser session list` shows was used in the last 10 minutes. It is too short if an agent's session expires mid-task, which shows as a repeated `load` mod `browser.launch` event for one session and agent.

**Drop it** when the CLI's default idle timeout is 10 minutes or less.

`CLAUDE_CODE_DISABLE_ARTIFACT=1` and `CLAUDE_CODE_SEND_FEEDBACK=0` take the `Artifact` and `SendFeedback` tools out of every interactive request. Together they cut an interactive main thread's first turn from 58.6k to 44.0k tokens, measured on 2026-10-16 from two otherwise identical sessions' transcripts. Between 2026-07-08 and 2026-10-16, `Artifact` was called in 32 of 2,161 sessions across both hosts, and `SendFeedback` in 22. A launch environment does not override the settings value, so a session that needs to publish an artifact starts with `--settings` pointing at a copy of this file without the variable.

**Drop them** when `Artifact` loads deferred behind ToolSearch, or when relaunching to publish becomes routine.

## Hooks

Why a hook entry in `user/settings.json` or `managed/settings.json` earns its place, and what would retire it, for the entries that ship no `README.md` of their own. The hook scripts live in [`user/hooks/`](../user/hooks).

[`find-scope`](../user/hooks/find-scope) denies, on a `PreToolUse` matching `Bash`, a `find` whose first operand is `/`, `~`, `$HOME`, or a bare home directory and which carries no `-maxdepth`. Over the 262,859 Bash calls recorded between 2026-04-21 and 2026-09-09 the matcher fires on 237, a tenth of a percent, and those 237 ran a median of 85 seconds and burned 5.1 hours between them. A third returned nothing at all, having hit the 120-second Bash timeout or been pushed to the background. The native instruction to prefer Grep and Glob over the shell was already in force for every one of them, which is why this is a hook rather than another line of prose. The `if` filter keeps the spawn to roughly 2,500 Bash calls a month. Matching hooks run in parallel, and this one overlaps the `worktree` hook rather than queueing behind it.

Blanket forms of this rule do not survive the same corpus. Capping every `find` at a two-second timeout, the shape this was modeled on, fires on about one `find` call in five, and the narrowly rooted ones it would kill run a median around 300 milliseconds with a legitimate multi-second tail. Restricting the deny to a broad root and no depth bound holds precision at 95.4%: of the 237, only 11 finished under two seconds, and 8 of those were a `known/path || find / ...` fallback whose primary succeeded. That fallback shape stays denied on purpose, because across all 26 of its occurrences the fallback did run, at a median of 40 seconds.

**Delete it** if the behavior stops. Around 2026-12-01, re-run the matcher over the corpus from the day this shipped. If it fires fewer than about 15 times a month, the model has stopped running disk-wide `find` and the `user/CLAUDE.md` line alone is enough. **Narrow it** instead if the fast denials grow past roughly one in ten, which would mean scoped searches are being caught and the root test needs tightening.

```
bun user/hooks/find-scope/audit.ts --since <ship-date>
```

`moshi-hook claude-hook` takes ten entries across eight events: one each on `PermissionRequest`, `SessionStart`, `SessionEnd`, `Stop`, and `UserPromptSubmit`, a `permission_prompt` match on `Notification`, and an `AskUserQuestion` and `ExitPlanMode` pair on each of `PreToolUse` and `PostToolUse`. They carry approvals and session state to Moshi, which is what lets a permission prompt be answered away from the machine. `moshi-hook install --target claude` writes all ten, so treat them as generated output and regenerate rather than hand-edit. The `async` flags are the generator's. `PermissionRequest` alone stays synchronous, blocking to return a remote `permissionDecision`. The other nine run fire-and-forget, `Stop` included. Claude Code kills a backgrounded `Stop` hook's process before it finishes, so Moshi's `Stop` entry can drop its push, and changing it by hand lasts only until the next `install`.

Regenerate against a scratch config directory. A plain `install` writes `~/.claude/settings.json` through the symlink into the deployed `~/.claude-repo` clone, and re-sorts every key in the file on its way through. `moshi-hook` honors `CLAUDE_CONFIG_DIR`, and `jq -S` sorts away the reordering that would otherwise swamp the comparison:

```sh
mkdir -p "$TMPDIR/cc" && cp user/settings.json "$TMPDIR/cc/settings.json"
CLAUDE_CONFIG_DIR="$TMPDIR/cc" moshi-hook install --target claude
jq -S .hooks user/settings.json > "$TMPDIR/before.json"
jq -S .hooks "$TMPDIR/cc/settings.json" > "$TMPDIR/after.json"
diff "$TMPDIR/before.json" "$TMPDIR/after.json"
```

`moshi-hook status` calls these entries stale whenever an event it owns also holds a hook it did not write, because it compares the event's whole group list against its own generated output. Branch `chief` adds a `chief-tap.ts` entry to five of them, which is enough to make `status` name `Notification`, `PermissionRequest`, `PostToolUse`, `SessionStart`, and `Stop` outdated against a file whose Moshi entries are current. Appending one `/bin/sh -c 'true'` group to `Stop` in a scratch copy reproduces it. Re-running `install` does not clear the report, because it leaves the foreign group in place and re-appends its own entry last. Read `status` against a scratch copy of the tracked file before acting on it, where the same command reports `claude current`.

**Delete them** when a permission prompt no longer needs answering off the machine, which `moshi-hook unpair` and `moshi-hook uninstall --target claude` would follow. Re-run the regeneration above when a `moshi-hook` release changes the hook set, and take the generator's output for the entries it owns, then put the `unless-desktop.sh` prefix below back on each one. Verified against 0.3.22.

[`unless-desktop.sh`](../user/hooks/unless-desktop.sh) wraps every `moshi-hook` command and skips it under a `claude-desktop*` entrypoint, where the app draws its own notifications and approvals. Skips log to hook metrics as `unless-desktop`.

**Drop it** by 2027-01-15 if no `unless-desktop` rows appear, or sooner if the app misses a prompt Moshi would have delivered.

## Plugins

`extraKnownMarketplaces.bendrucker` is a `github` source here, and on local machines a managed drop-in outranks it with a `directory` source at the deployed clone, `~/.claude-repo`, which `claude-sync` keeps on `main`. dotfiles' `claude/install.sh` writes that drop-in from `$HOME`, because Claude Code expands no `~` in a `directory` path and resolves a relative one against the project, so no tracked file can hold it (verified against CLI 2.1.302). Claude Code loads a relative-path plugin from a local marketplace in place, so a pulled change takes effect at the next session start or `/reload-plugins`, with no cached copy and no version to bump. It installs no npm dependencies for an in-place plugin, so `claude-sync` runs `bun install --frozen-lockfile` at the clone's root, whose workspaces cover every plugin. An entry that names its own repo, like `honeycomb`, is still copied into the cache when enabled. Public consumers, and a machine without the drop-in, install through the cache, which is what `plugin-lockfiles check` protects.

**Drop the drop-in** if dotfiles stops deploying `~/.claude-repo`, or drop the `bun install` if Claude Code starts installing in-place dependencies itself.

`auto-mode@bendrucker` collects enhancements for auto mode. Its first mod records every tool call's permission verdict, the only record of asks that end in approval. Revisit the verdict mod around 2026-11-09.

**Keep it** if a change has drawn on the `classifier_verdicts` view by then, such as tuning which blocks the escalation mod asks about, or a finding in a session review. **Drop it** otherwise: remove the mod, and the plugin with it if nothing else has joined, and let `mod-events` retention expire the recorded events.

`pluginConfigs` sets `load@bendrucker` for these Macs, where an agent's heavy work slows everything else on the machine. Cloud sessions never read this file, so there the mod stays inert and can saturate the VM. The caps are generous backstops: 4 builds and test runs, and 4 DuckDB processes, after 20 concurrent DuckDB processes forced a hard reset. Reminders start at 1.5x load per core (`remind`), turn firm at 3x (`warn`), and capped commands are refused above 4x (`refuse`). **Tighten a cap** when `cap.start` events show its pool full during a slowdown. **Raise `remind`** if `pace` events fire on a machine that still feels responsive.

## Sandbox Findings

Mechanism behind the rules in [`settings.md`](../.claude/rules/settings.md), and the cases no setting can fix.

#### Write Denies Shadow Allows

The write profile emits every `allowOnly` rule before every `denyWithinAllow` rule, and Seatbelt takes the last matching rule, so a broad deny always beats a narrower allow no matter how specific. The read profile implements `allowWithinDeny` and has no such trap, and the [sandboxing docs](https://code.claude.com/docs/en/sandboxing) state the specificity rule only for reads. Confirmed with `sandbox-exec`: given a deny of a parent and an allow of a child, emitting the allow first denies the child, and emitting it last permits the child while the rest of the parent stays denied. The fix belongs upstream.

Three paths hit this:

- `~/.claude/plugins`. `~/.claude/plugins/data` sat in `allowWrite` for a while and never took effect.
- `~/.claude/jobs`. The harness tells background-job sessions to write under `$CLAUDE_JOB_DIR/tmp` and injects the deny itself, so `user/settings.json` cannot narrow it. Jobs fall back to `$TMPDIR`, losing the per-job isolation the directory was meant to provide.
- `~/.claude/projects`, holding the per-project memory directories. Only Bash runs under Seatbelt, so a `Write` from the tool layer lands while `rm` or `cp` on the same file returns `Operation not permitted`. Auto mode routing file edits through Bash is what makes the gap reachable so often. Verified inert against Claude Code 2.1.232.

The session index lives in `~/.local/share/claude-sessions`, clear of this deny. Its writers still skip the sandbox, for writes elsewhere under `~/.claude` (see the session skill's `CLAUDE.md`).

Do not wait for an upstream announcement. [#41156](https://github.com/anthropics/claude-code/issues/41156) raised the same conflict at the permission-prompt layer and was closed `NOT_PLANNED` by a staleness bot. Related: [#51973](https://github.com/anthropics/claude-code/issues/51973), [#34900](https://github.com/anthropics/claude-code/issues/34900).

#### Shared `.git/config`

The sandbox denies writes to every `.git/config` and `.git/hooks` path, and `allowWrite` cannot override that. A linked worktree shares the main checkout's `.git/config`, so a sandboxed `git push -u` from one pushes and then fails with `could not lock config file` while recording the upstream. The denial is deliberate. `core.hooksPath` or `core.fsmonitor` set in that file would run code in every worktree.

The `git` plugin's `push-upstream` hook records the tracking instead, since hooks run outside the sandbox. On a `git push -u <remote> <refspec>` from the current branch to an existing remote, it sets `branch.<name>.remote` and `branch.<name>.merge` and removes `-u` from the command. `-u` rewrites the config under its lock even when the values already match, so recording tracking ahead of time never spared the push. The hook writes only those two keys, which keeps the `core.*` risk out of reach.

Tracking is also recorded at creation for a bare `git push` and for herdr, which measures a branch against its upstream. The `herdr` plugin's dispatch, which its sandbox marker runs outside the sandbox, sets the same two keys when the repository has an `origin`, best-effort. Worktrunk's `wt switch --create` gets the same from a dotfiles `pre-start` hook. **Drop all three** when a sandboxed `git push -u origin HEAD 2>&1 | tail` from a linked worktree records its upstream.

#### Path Globs

An entry with no glob character becomes a Seatbelt `(subpath ...)` rule covering everything beneath it. An entry containing `*`, `?`, `[`, or `]` becomes a `(regex ...)` rule anchored at both ends, matching that one path and nothing inside it. `/var/folders/*/*/T` granted the temp directory itself while every `mktemp` inside it failed.

A trailing `/**` does not fix that, because the harness strips `/**` off the end of every sandbox path before building the profile. That is what turns a plain `/foo/**` into the recursive `(subpath "/foo")`, and what turns `/var/folders/*/*/T/**` back into the anchored regex. `/**/*` survives the strip and compiles to `(.*/)?[^/]*`, matching any depth. `/*` reaches direct children only.

Verified against Claude Code 2.1.232 with nested `claude --settings <file> -p` runs: the bare glob and `/**` both failed `touch <tmpdir>/probe`, `/*` failed one level deeper, and `/**/*` passed `touch`, nested `mkdir`, `mktemp`, and `mktemp -d`. `sandbox-exec` on hand-written profiles confirmed the underlying rule semantics.

Seatbelt matches resolved paths, so a rule spelled `/var/...` matches nothing on macOS. The harness realpaths the literal prefix of each entry before emitting it, which is why `/var/folders/...` works in settings while a hand-written probe profile needs `/private/var/folders/...`.

`/var/folders/*/*/T/**/*` earns its place only because some tools ignore `TMPDIR`. The `xcrun` shims call `confstr(_CS_DARWIN_USER_TEMP_DIR)` and write `xcrun_db-*` there whatever the environment says, which is how a sandboxed `strings` fails today. **Drop it** once a sandboxed `strings` on a Mach-O binary stops touching `/var/folders`.

#### Bare `/tmp`

`/tmp` is a symlink to `/private/tmp`, and the harness does not resolve it for a bare `/tmp` entry or for globs beneath it. `/tmp`, `/tmp/*`, and `/tmp/**/*` all left a `mkdir` directly in `/tmp` failing `Operation not permitted`. A narrow existing child such as `/tmp/claude` is resolved, which is why the scratchpad under `/tmp/claude-<uid>` always accepted writes. The entry is spelled `/private/tmp`, which passed `touch`, nested `mkdir`, and `mktemp` against Claude Code 2.1.301. **Respell it** `/tmp` once a bare `/tmp` entry passes the same probe.

`env` sets `TMPDIR=/tmp`, but the harness overrides it per session to the scratchpad. The harness doesn't expand `env` values, so `~` and `$HOME` cannot build a portable path there. Grant a tool's default directory in `allowWrite` instead of redirecting it through `env`.

#### Chromium

Headless Chromium dies at startup under the sandbox because it registers Mach services, and `allowMachLookup` grants only lookups. An `org.chromium.*` entry left `chrome-headless-shell --dump-dom` failing against Claude Code 2.1.301. `agent-browser` runs escaped for this reason. A Playwright test run needs the sandbox disabled.

#### `/dev/fd`

The `/dev/fd` entry is inert, and no path-based rule can replace it. `diff <(echo a) <(echo b)` fails with `Operation not permitted` on `/dev/fd/<n>` under a `sandbox-exec` profile allowing `(subpath "/dev/fd")`, and under one allowing `(subpath "/dev")`, while an unfiltered `(allow file-write*)` passes. The kernel resolves `/dev/fd/<n>` to the underlying pipe, which has no filesystem path for a `subpath` or `regex` filter to match. Process substitution stays broken until upstream changes how the write profile is built. Removing the entry is a separate change.

## Auto Mode Findings

`useAutoModeDuringPlan` needs no entry. It defaults on as of v2.1.218 and routes plan-mode shell commands through the classifier instead of prompting them. The gate is that auto mode is *available* to the account, so it is not a reason to set `defaultMode`. The settings schema muddies this by saying the key "has no effect unless `permissions.defaultMode` allows auto", which reads as a requirement that the active mode be `auto`.

Every classifier denial lands in the transcript as a tool result error, so the session index measures the `autoMode` rules directly: `tool_errors.denial_kind` is `automode-blocked` or `automode-unavailable`, and `error_content` carries the `[Category]` reason.

#### Git Discard Denials

Git working-tree discards were the largest denial cluster common to every machine from August to September 2026: `git reset --hard <upstream>`, tree-wide `git checkout -- .` and `git restore`, `git clean`, `git stash drop`, and `git checkout --ours`. The built-in Irreversible Local Destruction rule presumes a dirty tree and clears only for a worktree the session visibly created, which a worktree created before the session starts never is.

Two `allow` entries narrow it where nothing can be lost. Conflict Side Selection covers `--ours`/`--theirs` during an in-progress operation. Own Stash Drop covers the tagged push, apply, and drop sequence the harness itself prescribes for shared stashes. The global CLAUDE.md line on `git merge --ff-only` and per-path `git restore` handles the resets, which have no safe classifier-side exception.

Retire each entry when the session index shows it inert. Count `automode-blocked` rows whose command starts with the matching verb, before and after the merge. If `reset --hard` denials hold steady three weeks out, the CLAUDE.md line is not steering and comes out.
