# Claude Code Plugin Marketplace

This repository contains my personal Claude Code configuration and a plugin marketplace (`bendrucker`) that allows others to install portions of my setup.

## Structure

- `plugins/`: Plugins providing language support, workflows, and integrations
- `.claude-plugin/marketplace.json`: Marketplace definition listing all available plugins
- `schemas/`: JSON Schemas for Claude Code config formats. Upstream-backed ones (`plugin`, `marketplace`, `settings`) keep only our edits as an RFC 6902 overlay in [`schemas/overlays/`](schemas/overlays/), merged with the live upstream base in memory at validation time; the rest are hand-authored
- `user/`: User-level configuration, symlinked to `~/.claude`
- `docs/`: Reference material too long to auto-inject, linked from the rule that needs it
- `.claude/`: Project-level configuration for this repository

## User

The [`user/`](user/) directory contains user-level Claude Code configuration that gets symlinked to `~/.claude`. This includes global instructions (`CLAUDE.md`), settings (plugins, permissions, sandbox), and hooks that apply across all projects. Symlinks and other system setup are managed by the [claude topic](https://github.com/bendrucker/dotfiles/tree/main/claude) in dotfiles.

## Curation

Every customization (skill, hook, wordlist entry, agent, rule, permission) costs tokens on every session that touches it. Adding is cheap, accumulation is silent, and removal has no natural trigger. Before adding one, define how it gets removed: what evidence shows it's earning its cost, what evidence shows it isn't, and where that evidence surfaces. Detectors of model behavior need particular care: models drift and rules lose value, so pair detection with a path to evolve or retire.

An invoked skill's body is re-injected in full at every compaction, so `SKILL.md` size is a recurring per-compaction cost rather than a one-time load. Author bodies under roughly 4k tokens and keep the detail in `references/`.

A customization must also stay harmonious with Claude Code's native behavior. When the harness changes a default or an application-level behavior, assume the change encodes aggregate usage data and evaluation knowledge you do not have, and default to accommodating that direction rather than overriding it. So before adding a customization that touches native behavior, apply the harmony test: ask whether it works with the harness's intent or against it, and prefer accommodation. Add a customization that pushes back on a native behavior only as a light-touch experiment, carrying explicit forward evaluation criteria and a removal trigger. When Claude Code v2.1.198 made the built-in `Explore` agent inherit the conversation model (capped at Opus) instead of running on Haiku, hard-pinning it back to Haiku would contravene that intent, so any Explore steering stays a soft default and gets removed if it proves inert after a couple of weeks.

## Rules

Path-specific guidance lives in [`.claude/rules/`](.claude/rules/) and auto-injects when you touch matching files (via `paths` frontmatter), so it stays out of this always-on file:

- [`plugins.md`](.claude/rules/plugins.md) (`plugins/**`): plugin architecture, naming, MCP tool naming, READMEs, metadata, dependencies
- [`scripts.md`](.claude/rules/scripts.md) (`**/*.ts`): Bun runtime, AST-based parsing, script conventions, terminal colors, sandbox/nested-command pattern
- [`hooks.md`](.claude/rules/hooks.md) (`**/hooks.json`, `**/hooks/**`): hook guidance, quoting, MCP matcher validation
- [`settings.md`](.claude/rules/settings.md) (`**/settings*.json`): permission paths, `autoMode` scoping, sandbox and `excludedCommands`. Per-entry rationale and removal criteria live in [`docs/settings.md`](docs/settings.md), which does not auto-inject
- [`testing.md`](.claude/rules/testing.md) (test and workflow files): testing conventions, CI structure
- [`lockfile.md`](.claude/rules/lockfile.md) (`bun.lock`, `**/package.json`): lockfile conflict resolution
- [`schemas.md`](.claude/rules/schemas.md) (`schemas/**`): schema overlays, generated vs hand-authored artifacts

`user/rules/` (note: under `user/`, not `.claude/`) holds rules that apply across all repos and get symlinked to `~/.claude/rules/`. Use those for language/file-type guidance Claude should always have. Use skills for workflow-specific knowledge that requires explicit activation.

## Verification

- `bun scripts/check-marketplace.ts`: verifies all plugin directories are listed in `marketplace.json`. Runs in CI.
- `bun scripts/check-hook-paths.ts`: verifies every hook command in `user/settings.json` and `.claude/settings.json` names a tracked path, so a hook cannot outlive the script it invokes. Runs in CI.
- `bun run schemas check`: fetches current upstream and verifies the upstream-backed schema overlays still apply, flagging overlay edits that upstream has absorbed and warning on edits that overwrite an upstream definition. Runs in CI.
- `bun run skill-lint "plugins/<name>/skills/*"`: validates SKILL.md frontmatter and reference depth. `skill-lint` is a workspace package in `packages/skill-lint`, not an npm registry package.
- `bun run check`: runs `oxlint --type-aware` then `oxfmt --check`. Runs in CI.

## Evals

Per-skill harnesses live inside the plugin they measure, at `plugins/<plugin>/evals/<suite>/`, with a README per harness covering its loop: `pull-request/evals/pr-body`, `issue/evals/issue-refine`, `review/evals/review-voice`, `writing/evals/writing`, and `comments/evals/comment-density`. They share a shape: mine a sample, label it in a browser, then score or A/B. Hand-made ground truth stays tracked (`scenarios/`, `labels.json`, `briefs/`, `drafts/`). The bulky regenerables (`data/`, `feedback/`, `results/`, `raw/`, `labels/`, `ab/`) are gitignored, as is the shared `evals/results/` corpus, and some hold work-repo content that must not land here. The generic layer stays in [`evals/`](evals/): the corpus, the export and cost scripts, and their tests.

- `bun run --cwd plugins/pull-request/evals/pr-body eval:smoke` for two cases and `eval` for all eight, both promptfoo A/B runs. `scripts/judge.ts <run-dir>` is retained as the blinded audit reference for the rubric graders. Also `scripts/mine.ts`, `label/server.ts`, and `calibrate.ts` for the heading screen, whose classifier `labels.json` calibrates
- `bun plugins/issue/evals/issue-refine/scripts/build-dataset.ts`, then `label/server.ts`, then `scripts/ab-report.ts` and `scripts/judge.ts`
- `bun plugins/review/evals/review-voice/scripts/mine.ts`, then `label/server.ts`, then `scripts/report.ts`
- `bun plugins/writing/evals/writing/scripts/mine.ts`, then `label/server.ts` (scorer and judge are not built yet)
- `bun plugins/comments/evals/eval.ts build`, hand the printed `<preflight>` block to the Workflow tool, then `score --job <dir> --gate`. This is the comments judge's ship gate: it scores the labeled corpus through the workflow that ships, on subscription auth. `eval.ts --gate` scores the same corpus through the SDK oracle as a keyed cross-check

`pull-request:create`, `pull-request:follow-up`, `review:follow-up`, and `writing:no-diary` each carry a `promptfooconfig.yaml` under their `evals/` dir: an in-repo promptfoo suite that loads the plugin and grades cases with `llm-rubric` asserts. Those four run manually; `eval.yml` wires only the pr-body suite into CI. [`evals/scripts/`](evals/scripts/) files promptfoo runs into the durable corpus and reports what they cost.

Every promptfoo suite runs unkeyed against the logged-in Claude Code CLI, so leave `ANTHROPIC_API_KEY` unset for a local run. The provider hands its whole environment to the spawned CLI, where an API key overrides the subscription login and bills the run. `ANTHROPIC_GRADER_API_KEY` is the optional override that grades through the API instead. CI spends subscription credits too, via a `CLAUDE_CODE_OAUTH_TOKEN` secret from `claude setup-token`.

The older runners still read `ANTHROPIC_API_KEY` from the environment: the pr-body harness's `scripts/run-eval.ts` and `scripts/judge.ts`, `plugins/comments/evals/eval.ts --gate` (the oracle cross-check, not the gate itself), and `plugins/writing/skills/analyze` with `--judge`. [`evals/op.env`](evals/op.env) holds the 1Password secret reference, which `op run` resolves at run time, so no secret rests on disk. Reserve it for those runners, since injecting a key into a promptfoo run bills it:

```bash
op run --env-file=evals/op.env -- bun plugins/pull-request/evals/pr-body/scripts/judge.ts <run-dir>
```

`.github/workflows/eval.yml` runs a suite only when a pull request touches that suite's paths and carries the `eval` label.

## Workflow

- The `user/` directory is symlinked to `~/.claude/`. New files are immediately available.
- Plugin changes take effect immediately in new Claude sessions.
- To test a plugin in isolation: `claude --plugin-dir ./plugins/<name> --setting-sources local`.
- To test `user/settings.json` before installing: `./dev.sh` (any extra args pass through to `claude`).
