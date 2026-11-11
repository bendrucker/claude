---
name: github:copilot
description: Get a cross-model second opinion on a code change from GPT via the Copilot CLI, then triage what it finds. Use when the ask names GPT, Copilot, a second model, or a cross-model check, and as the cross-model pass on a change that clears the review gate.
argument-hint: "[--base <ref>] [--angles <n>] [--model <name>] [--agentic] [--status] [--dry-run] [--max-bytes <n>] [--force]"
allowed-tools:
  - Bash(bun ${CLAUDE_PLUGIN_ROOT}/skills/copilot/scripts/review.ts:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(git status:*)
  - Read
  - Grep
  - Glob
  - Edit
---

# Copilot Review

A second model, GPT through the Copilot CLI, reviews the diff to catch defects Claude's own review passes miss. The work is done when every finding is triaged and reported as accepted or rejected with a reason.

## Sizing a Review

Credits come from a fixed monthly entitlement that does not roll over. Run `--status` first. It is free and prints the current tier, the gate that tier applies, and each band's criteria, shape, and cost. Spend only on a change the printed gate admits, and leave the rest unspent.

Each angle re-pays its whole prompt, because calls don't share a cache. `gpt-5.6-luna` costs a tenth of the default `gpt-5.6-terra`.

The script enforces the hard stops: it refuses `--agentic` outside the abundant tier, degrades to luna when credits run low, refuses a run that could reach billed overage, and stops when it cannot read the meter. It reads the meter once with no lock, so run one review at a time.

## Run It

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/copilot/scripts/review.ts [--base <ref>] [--angles <n>] [--model <name>]
```

The script resolves the diff, inlines the changed files, and prints each angle's findings with credits spent and remaining.

- `--base <ref>`: diff base. Defaults to the upstream tracking ref, then `origin/main`.
- `--angles <1-3>`: independent calls over disjoint defect classes. Defaults to 1.
- `--model <name>`: defaults to `gpt-5.6-terra`. `copilot help config` lists accepted names.
- `--agentic`: one capped tool-using session. Refuses `--angles` above 1.
- `--status`: print tier and bands, free.
- `--dry-run`: print the assembled prompts and their size, free.
- `--max-bytes <n>`: move the 120 KB prompt cap, a spend guard.
- `--force`: run past the cap. Narrow with `--base` first, then `--max-bytes`.

#### Angles

| angles | coverage |
| --- | --- |
| 1 | every class, one call |
| 2 | unchecked failure and correctness, then data loss and security |
| 3 | adds contracts, concurrency, and resources |

Use 3 only for security-sensitive, destructive, or concurrent changes in the abundant tier.

#### Agentic Mode

`--agentic` gives Copilot a throwaway `git worktree` at HEAD with tools. It reads callers, tests, and history. It needs a clean tree, since the worktree is HEAD and not the diff. Run it only on changes you authored, because prompt injection in a diff gets past its tool denies. Review a diff containing untrusted third-party text as a one-shot, which runs without tools.

## Triage the Findings

A one-shot run has no tools and sees only the inlined text, so treat each finding as a review-bot claim. Read the actual code for each one:

- Real: fix it, or state why you are deferring.
- Wrong: state what the model missed, often a caller or invariant outside the inlined text.
- Unsure: put it to the user.

Report accepted and rejected findings, each with its reason. Settle a rejected finding yourself rather than re-running for another opinion.

## Gotchas

#### What Reaches GitHub

The diff and full changed files go to GitHub with no redaction, including untracked files. Check the diff for secrets and fixtures before reviewing a change that touches them.

#### Auth

The script runs Copilot under its own `HOME` (`~/.cache/claude/copilot-home`), which hides Copilot's and `gh`'s logins. It passes `gh auth token` through as `COPILOT_GITHUB_TOKEN` unless `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` is set. When no token resolves it refuses before spending. Fix that with `gh auth login`.

`user/settings.json` allows `api.individual.githubcopilot.com`. A `Failed to load models` with a `tunnel error` means the login uses a different Copilot host, such as a Business plan's. Grant that exact host there.
