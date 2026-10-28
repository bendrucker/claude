# Eval Stubs

Offline `gh` and `glab` stand-ins for native eval cases, and the git-init preamble their fixtures share.

A suite that uses them lists `packages/eval-stubs` under `stage` in its `suite.yaml`, so `evals/native/run.ts` stages the package at the same repo-relative path as in the checkout. A case's `fixture.sh` then reaches it from its own directory:

```bash
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/acme/api-server.git
```

- [`install.sh`](install.sh) bundles [`gh.ts`](gh.ts) and [`glab.ts`](glab.ts) into `$HOME/.eval-stubs/` and puts them first on `PATH` through `$HOME/.zshenv` and `$HOME/.bashrc`, the startup files the Bash tool's zsh and bash read in an eval run. The sources import only runtime builtins, since the staged tree has no `node_modules`.
- [`preamble.sh`](preamble.sh) starts the repo on `main` with the given origin and defines `commit DATE MESSAGE` and `commit_as NAME EMAIL DATE MESSAGE`, which print the new SHA.

## Modes

- **Snapshot**: the fixture writes `$HOME/.eval-stubs/meta.json` describing one pull request (`repo`, `pull`, `reviews`, `threads`, optional `checks`) or merge request (`host`, `project`, `mr`, `versions`, `discussions`), plus `root` and the SHAs it committed. The `Meta` types in `gh.ts` and `glab.ts` define the fields. Diffs, commits, and file contents come from the scaffolded repo. Every write is refused.
- **Echo**: with no `meta.json`, `gh pr create|edit`, `glab mr create|update`, and `glab mr|issue note`, and a `glab api` POST to a notes or discussions endpoint (reading `-F body=@<path>` as glab does) print the title and body between `PR-TITLE:`, `PR-BODY-BEGIN`, and `PR-BODY-END` lines, then the URL. Every other command fails as offline.

`install.sh --check <module>` bundles a module whose default export maps a create or edit body to verdict lines, which echo mode prints after the URL and writes to `.eval-verdicts` in the run's working directory, replacing the previous call's. A `{ source: file, path: .eval-verdicts }` `regex` grader then scores the run in-run, unaffected by output the session pipes through `tail` or `head`. `install.sh` starts the file empty, so a run with no counted call fails those graders instead of erroring. A `--dry-run` or a body under three words is a probe and records nothing. A `--body-file` that can't be read fails the call with gh's error and prints no verdicts. `--offline` makes create and edit print only those lines and fail as offline, for a case graded on the drafted reply. [`pr-body/limits.ts`](../../plugins/pull-request/evals/pr-body/limits.ts) and [`note-body/check.ts`](../../plugins/gitlab/evals/note-body/check.ts) are the checks. The module and anything it imports must be staged, with their dependencies resolvable from a staged plugin's `node_modules`.

## Tests

```bash
bun test packages/eval-stubs
```
