# Claude Code Plugin Marketplace

This repository contains my personal Claude Code configuration and a plugin marketplace (`bendrucker`) that allows others to install portions of my setup.

## Structure

- `schemas/`: JSON Schemas for Claude Code config formats. Upstream-backed ones (`plugin`, `marketplace`, `settings`) keep only our edits as an RFC 6902 overlay in [`schemas/overlays/`](schemas/overlays/), merged with the live upstream base in memory at validation time; the rest are hand-authored
- `user/`: User-level configuration, symlinked to `~/.claude` by the [claude topic](https://github.com/bendrucker/dotfiles/tree/main/claude) in dotfiles
- `docs/`: Reference material too long to auto-inject, linked from the rule that needs it

## Curation

Detectors of model behavior need particular care: models drift and rules lose value, so pair detection with a path to evolve or retire.

An invoked skill's body is re-injected in full at every compaction, so `SKILL.md` size is a recurring per-compaction cost rather than a one-time load. Author bodies under roughly 4k tokens and keep the detail in `references/`.

When the harness changes a default, assume the change encodes usage data you do not have and accommodate it. Push back only as a light-touch experiment with evaluation criteria and a removal trigger. Example: Claude Code v2.1.198 made `Explore` inherit the conversation model (capped at Opus) instead of Haiku, so Explore steering stays a soft default and is removed if inert after a couple of weeks.

## Observability

Tooling here must be observable on my machines. Ship each mod, hook, or script with telemetry Claude can query and something that reads it. A mod emits through `mod-events`, which the session index reads into `mod_events` for its `mods` query ([`mods.md`](.claude/rules/mods.md)). A visibility gap outranks any new feature, so see before acting.

## Rules

Path-specific guidance lives in [`.claude/rules/`](.claude/rules/). `bun run inventory rules` lists each rule with the paths it applies to. Per-entry rationale and removal criteria for `settings.md` live in [`docs/settings.md`](docs/settings.md), which does not auto-inject.

`user/rules/` (note: under `user/`, not `.claude/`) holds rules that apply across all repos and get symlinked to `~/.claude/rules/`.

## Verification

- `bun scripts/check-marketplace.ts`: verifies all plugin directories are listed in `marketplace.json`. Runs in CI.
- `bun scripts/check-hook-paths.ts`: verifies every hook command in `user/settings.json` and `.claude/settings.json` names a tracked path, so a hook cannot outlive the script it invokes. Runs in CI.
- `bun run plugin-lockfiles check`: verifies every plugin declaring dependencies ships a lockfile that agrees with its `package.json`, which is what Claude Code requires before it will install those dependencies into the plugin cache. `generate` writes them. Runs in CI.
- `bun run schemas check`: fetches current upstream and verifies the upstream-backed schema overlays still apply, flagging overlay edits that upstream has absorbed and warning on edits that overwrite an upstream definition. Runs in CI.
- `bun run skill-lint "plugins/<name>/skills/*"`: validates SKILL.md frontmatter and reference depth. `skill-lint` is a workspace package in `packages/skill-lint`, not an npm registry package.
- `bun scripts/check-gating-catch.ts plugins/<name>`: fails on a mod's gating hook registered without `.catch`. Runs in CI and the `plugin-test` pre-commit hook.

## Inventory

To answer what customizations exist, run `bun run inventory [kind]` instead of reading through `plugins/`, `user/`, and `.claude/`. `--help` lists kinds and flags. `mods` lists each function-hooks module with its events, UI surfaces, and `hooks.json` description.

## Evals

Per-skill harnesses live at `plugins/<plugin>/evals/<suite>/`, each with a README covering its loop. They share a shape: mine a sample, label it in a browser, then score or A/B. Hand-made ground truth stays tracked (`scenarios/`, `labels.json`, `briefs/`, `drafts/`). The bulky regenerables (`data/`, `feedback/`, `results/`, `raw/`, `labels/`, `ab/`) are gitignored, and some hold work-repo content that must not land here.

- The pr-body A/B lives as `scenario-*` cases in the `pull-request/evals/create` suite. The pr-body harness's `scripts/judge.ts <run-dir>` is retained as the blinded audit reference for the rubric graders
- The comments judge's ship gate is `bun plugins/comments/evals/eval.ts build`, then hand the printed `<preflight>` block to the Workflow tool, then `score --job <dir> --gate`. It scores the labeled corpus through the workflow that ships, on subscription auth

Run a native `claude plugin eval` suite through `bun evals/native/run.ts <suite> -- <args>`, not the bare command. It strips `ANTHROPIC_API_KEY` so runs spend subscription credits, and stages the artifacts at `--ref` against the working-tree cases. Write each case as `<case>/case.yaml`, since `run.ts`, `check.ts`, and CI find cases by that file even though the runner also accepts `prompt.md`. A suite testing skills, agents, or context files outside a plugin wraps them through `suite.yaml`, because the runner ignores a `CLAUDE.md` or `.claude/rules` in the case's working directory. [`evals/README.md`](evals/README.md) covers the wrappers.

The older runners still read `ANTHROPIC_API_KEY` from the environment: the pr-body harness's `scripts/run-eval.ts` and `scripts/judge.ts`, `plugins/comments/evals/eval.ts --gate` (the oracle cross-check, not the gate itself), and `plugins/writing/skills/analyze` with `--judge`. [`evals/op.env`](evals/op.env) holds the 1Password secret reference, which `op run` resolves at run time, so no secret rests on disk. Reserve it for those runners:

```bash
op run --env-file=evals/op.env -- bun plugins/pull-request/evals/pr-body/scripts/judge.ts <run-dir>
```

CI spends subscription credits through a `CLAUDE_CODE_OAUTH_TOKEN` secret from `claude setup-token`. `eval.yml` runs the native suites of every plugin a pull request touches once it carries the `eval` label, skipping a suite that holds a `.local-only` file. `gh workflow run eval.yml --ref <branch> -f suite=<dir>` runs any suite on demand.

## Workflow

- To test a plugin in isolation: `claude --plugin-dir ./plugins/<name> --setting-sources local`.
- To test `user/settings.json` before installing: `./dev.sh` (any extra args pass through to `claude`).
