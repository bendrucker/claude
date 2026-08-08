# Claude Code Plugin Marketplace

This repository contains my personal Claude Code configuration and a plugin marketplace (`bendrucker`) that allows others to install portions of my setup.

## Structure

- `plugins/`: Plugins providing language support, workflows, and integrations
- `.claude-plugin/marketplace.json`: Marketplace definition listing all available plugins
- `schemas/`: JSON Schemas for Claude Code config formats. Upstream-backed ones (`plugin`, `marketplace`, `settings`) keep only our edits as an RFC 6902 overlay in [`schemas/overlays/`](schemas/overlays/), merged with the live upstream base in memory at validation time; the rest are hand-authored
- `user/`: User-level configuration, symlinked to `~/.claude`
- `.claude/`: Project-level configuration for this repository

## Inventory

`bun run inventory [kind]` lists the repository's Claude Code assets, so "which skills exist", "what registers a `Stop` hook", or "which plugins ship agents" takes one command instead of a glob sweep. Kinds: `summary` (default), `plugins`, `skills`, `agents`, `commands`, `hooks`, `rules`, `mcp`. Rows carry the asset's path and its scope (`plugins/`, `user/`, or `.claude/`), so a listing is the starting point for a `Read` or a narrowed `grep`. `--help` covers the flags.

## User

The [`user/`](user/) directory contains user-level Claude Code configuration that gets symlinked to `~/.claude`. This includes global instructions (`CLAUDE.md`), settings (plugins, permissions, sandbox), and hooks that apply across all projects. Symlinks and other system setup are managed by the [claude topic](https://github.com/bendrucker/dotfiles/tree/main/claude) in dotfiles.

## Curation

Every customization (skill, hook, wordlist entry, agent, rule, permission) costs tokens on every session that touches it. Adding is cheap, accumulation is silent, and removal has no natural trigger. Before adding one, define how it gets removed: what evidence shows it's earning its cost, what evidence shows it isn't, and where that evidence surfaces. Detectors of model behavior need particular care: models drift and rules lose value, so pair detection with a path to evolve or retire.

An invoked skill's body is re-injected in full at every compaction, so `SKILL.md` size is a recurring per-compaction cost rather than a one-time load. Author bodies under roughly 4k tokens and keep the detail in `references/`.

A customization must also stay harmonious with Claude Code's native behavior. When the harness changes a default or an application-level behavior, assume the change encodes aggregate usage data and evaluation knowledge you do not have, and default to accommodating that direction rather than overriding it. So before adding a customization that touches native behavior, apply the harmony test: ask whether it works with the harness's intent or against it, and prefer accommodation. Add a customization that pushes back on a native behavior only as a light-touch experiment, carrying explicit forward evaluation criteria and a removal trigger. When Claude Code v2.1.198 made the built-in `Explore` agent inherit the conversation model (capped at Opus) instead of running on Haiku, hard-pinning it back to Haiku would contravene that intent, so any Explore steering stays a soft default and gets removed if it proves inert after a couple of weeks.

## Rules

Path-specific guidance lives in [`.claude/rules/`](.claude/rules/) and auto-injects when you touch matching files (via `paths` frontmatter), so it stays out of this always-on file:

- [`plugins.md`](.claude/rules/plugins.md) (`plugins/**`): plugin architecture, naming, MCP tool naming, READMEs, metadata, dependencies
- [`scripts.md`](.claude/rules/scripts.md) (`**/*.ts`): Bun runtime, script conventions, terminal colors, sandbox/nested-command pattern
- [`hooks.md`](.claude/rules/hooks.md) (`**/hooks.json`, `**/hooks/**`): hook guidance, quoting, MCP matcher validation
- [`settings.md`](.claude/rules/settings.md) (`**/settings*.json`): permission paths, sandbox and `excludedCommands`
- [`testing.md`](.claude/rules/testing.md) (test and workflow files): testing conventions, CI structure
- [`lockfile.md`](.claude/rules/lockfile.md) (`bun.lock`, `**/package.json`): lockfile conflict resolution
- [`schemas.md`](.claude/rules/schemas.md) (`schemas/**`): schema overlays, generated vs hand-authored artifacts

`user/rules/` (note: under `user/`, not `.claude/`) holds rules that apply across all repos and get symlinked to `~/.claude/rules/`. Use those for language/file-type guidance Claude should always have. Use skills for workflow-specific knowledge that requires explicit activation.

## Verification

- `bun scripts/check-marketplace.ts`: verifies all plugin directories are listed in `marketplace.json`. Runs in CI.
- `bun scripts/check-hook-paths.ts`: verifies every hook command in `user/settings.json` and `.claude/settings.json` names a tracked path, so a hook cannot outlive the script it invokes. Runs in CI.
- `bun run schemas check`: fetches current upstream and verifies the upstream-backed schema overlays still apply, flagging overlay edits that upstream has absorbed and warning on edits that overwrite an upstream definition. Runs in CI.
- `bun run skill-lint "plugins/<name>/skills/*"`: validates SKILL.md frontmatter and reference depth. `skill-lint` is a workspace package in `packages/skill-lint`, not an npm registry package.

## Evals

Per-skill harnesses live in [`evals/`](evals/), one directory each for `pr-body`, `issue-refine`, `review-voice`, and `writing`, with a README per harness covering its loop. They share a shape: mine a sample, label it in a browser, then score or A/B. Hand-made ground truth stays tracked (`scenarios/`, `labels.json`, `briefs/`, `drafts/`). The bulky regenerables (`data/`, `feedback/`, `results/`, `raw/`, `labels/`, `ab/`) are gitignored, and some hold work-repo content that must not land here.

- `bun evals/pr-body/scripts/run-eval.ts --arm-a <current.md> --arm-b <revised.md>`, then `bun evals/pr-body/scripts/judge.ts <run-dir>` for the blinded judge. Also `scripts/mine.ts`, `label/server.ts`, and `calibrate.ts` for the heading screen
- `bun evals/issue-refine/scripts/build-dataset.ts`, then `label/server.ts`, then `scripts/ab-report.ts` and `scripts/judge.ts`
- `bun evals/review-voice/scripts/mine.ts`, then `label/server.ts`, then `scripts/report.ts`
- `bun evals/writing/scripts/mine.ts`, then `label/server.ts` (scorer and judge are not built yet)

Runners that make live API calls read `ANTHROPIC_API_KEY` from the environment. Source it from 1Password per command:

```bash
ANTHROPIC_API_KEY=$(op item get jx63slqb27yjg6lo7db6s42bde --fields credential --reveal) bun evals/pr-body/scripts/run-eval.ts --arm-a <current.md> --arm-b <revised.md>
```

The same prefix serves `plugins/comments/evals/eval.ts --gate` and `plugins/writing/skills/analyze` with `--judge`. Separately, `plugins/*/skills/*/evals/evals.json` holds prompt-and-expectation sets consumed by the external skill A/B harness.

## Workflow

- The `user/` directory is symlinked to `~/.claude/`. New files are immediately available.
- Plugin changes take effect immediately in new Claude sessions.
- To test a plugin in isolation: `claude --plugin-dir ./plugins/<name> --setting-sources local`.
- To test `user/settings.json` before installing: `./dev.sh` (any extra args pass through to `claude`).
