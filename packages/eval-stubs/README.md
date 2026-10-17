# Eval Stubs

Offline `gh` and `glab` stand-ins for native eval cases, and the git-init preamble their fixtures share.

A suite that uses them lists `packages/eval-stubs` under `stage` in its `suite.yaml`, so `evals/native/run.ts` stages the package at the same repo-relative path as in the checkout. A case's `fixture.sh` then reaches it from its own directory:

```bash
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/acme/api-server.git
```

- [`install.sh`](install.sh) bundles [`gh.ts`](gh.ts) and [`glab.ts`](glab.ts) into `$HOME/.eval-stubs/` and puts them first on `PATH` through `$HOME/.zshenv`, the one startup file the Bash tool sources in an eval run. The sources import only runtime builtins, since the staged tree has no `node_modules`.
- [`preamble.sh`](preamble.sh) starts the repo on `main` with the given origin and defines `commit DATE MESSAGE` and `commit_as NAME EMAIL DATE MESSAGE`, which print the new SHA.

## Modes

- **Snapshot**: the fixture writes `$HOME/.eval-stubs/meta.json` describing one pull request (`repo`, `pull`, `reviews`, `threads`, optional `checks`) or merge request (`host`, `project`, `mr`, `versions`, `discussions`), plus `root` and the SHAs it committed. The `Meta` types in `gh.ts` and `glab.ts` define the fields. Diffs, commits, and file contents come from the scaffolded repo. Every write is refused.
- **Echo**: with no `meta.json`, `gh pr create|edit` and `glab mr create|update` print the title and body between `PR-TITLE:`, `PR-BODY-BEGIN`, and `PR-BODY-END` lines, then the URL. Every other command fails as offline.

## Tests

```bash
bun test packages/eval-stubs
```
