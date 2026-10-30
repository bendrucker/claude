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

## Cost

The plan grants a fixed monthly credit entitlement that resets on the 1st and does not roll over.

- A terra call pays about 3.5 credits of fixed prompt overhead before reading any code, about half a median review.
- Output costs 6x input and 60x cache_read.
- Calls don't share a cache. Each angle or spawn re-pays its whole prompt.
- `gpt-5.6-luna` costs a tenth of terra for every token class.

| model | input | cache_read | cache_write | output |
| --- | --- | --- | --- | --- |
| `gpt-5.6-terra` | 200 | 20 | 250 | 1200 |
| `gpt-5.6-luna` | 20 | 2 | 25 | 120 |

Rates are credits per million tokens, from the CLI's usage ledger.

## Sizing a Review

`--status` prints the tier and bands for free. Run it when unsure whether a change qualifies.

The tier comes from `pace`, credits remaining divided by days to reset: under 25 is constrained, over 60 is abundant, between is normal. The tier sets how strict the gate is. Spend only on changes the gate admits, and leave the rest of the allotment unspent.

| tier | gate |
| --- | --- |
| constrained | terra only on risk-surface hits, luna one-shot otherwise |
| normal | terra one-shot on gate-worthy changes, skip the rest |
| abundant | terra one-shot on any substantial human change, 3 angles on the risk class, agentic available |

The bands reuse the Bot Review Gate criteria from the `ship` skill:

| band | criteria | shape | cost |
| --- | --- | --- | --- |
| skip | bot bumps, prose, lockfiles, reverts, config away from the risk surfaces | none | 0 |
| deep | a runtime surface, auth, sandbox, permissions, secrets, or egress; over ~200 lines or 8 files excluding tests, docs, and lockfiles; a bug `code-review` confirmed; a session that drifted | terra, 1 angle | 7.6-12.4 |
| deep+ | risk-surface hits, abundant tier only | terra, 3 angles | ~22.7 |
| agentic | destructive, concurrent, or auth changes, abundant tier only | capped session | up to 60 |

The script enforces the hard stops. It refuses `--agentic` outside the abundant tier, degrades to luna below 150 credits remaining, refuses a run whose session cap could reach billed overage, and stops when it cannot read the meter. It reads the meter once with no lock, so run one review at a time.

## Run It

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/copilot/scripts/review.ts [--base <ref>] [--angles <n>] [--model <name>]
```

The script resolves the diff, inlines the changed files, and prints each angle's findings with credits spent and remaining.

- `--base <ref>`: diff base. Defaults to the upstream tracking ref, then `origin/main`.
- `--angles <1-3>`: independent calls over disjoint defect classes. Defaults to 1.
- `--model <name>`: defaults to `gpt-5.6-terra`.
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

`--agentic` gives Copilot a throwaway `git worktree` at HEAD with tools. It reads callers, tests, and history. It runs under a 60-credit cap, several times a one-shot's cost. It needs a clean tree. Otherwise the worktree differs from the diff. Use it only on changes you authored. Review a diff containing untrusted third-party text as a one-shot, which runs without tools.

#### Models

`copilot help config` lists the model names the CLI accepts. A listed name can still return "not available" on this account, and a rejected probe is free because the CLI fails before inference. The GPT-5.6 family is `sol`, `terra`, and `luna`, and `sol` is not reachable on this plan.

## Triage the Findings

A one-shot run has no tools and sees only the inlined text, so treat each finding as a review-bot claim. Read the actual code for each one:

- Real: fix it, or state why you are deferring.
- Wrong: state what the model missed, often a caller or invariant outside the inlined text.
- Unsure: put it to the user.

Report accepted and rejected findings, each with its reason. Settle a rejected finding yourself rather than re-running for another opinion.

## Gotchas

#### Sandbox, `HOME`, and Auth

The script points `HOME` at `~/.cache/claude/copilot-home`, because the sandbox blocks writes to `~/.copilot` (`I/O error: Operation not permitted (os error 1)`). Keep the sandbox on. That home persists. Read the spend ledger there afterward, and resume a session with `--resume`. `--no-custom-instructions` keeps repo instructions out of the review.

The redirect hides Copilot's own logins and `gh`'s. When none of `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` is set, the script runs `gh auth token` under the real `HOME` and passes it as `COPILOT_GITHUB_TOKEN`. When no token resolves, it refuses before spending. Fix that with `gh auth login` or by exporting one of the three variables.

`user/settings.json` allows `api.individual.githubcopilot.com`. A `Failed to load models` with a `tunnel error` means the login uses a different Copilot host, such as a Business plan's. Grant that exact host there.

#### What Reaches GitHub

The diff and full changed files go to GitHub with no redaction, including untracked files from `git ls-files --others --exclude-standard`. The script skips symlinks that point out of the repository. Check the diff for secrets and fixtures before reviewing a change that touches them.

#### Agentic Containment

Agentic mode passes `--allow-all-tools` minus `--deny-tool write`, `--deny-tool url`, `shell(git push)`, `shell(gh:*)`, `shell(curl:*)`, and `shell(wget:*)`. It contains misbehavior. A deliberate attacker can get past it.

- Shell redirection can still write. The disposable worktree is the write barrier.
- The worktree shares the parent's `.git`. `git update-ref` and `git config` reach the real repository. The reflog records ref moves.
- Deny matching works on first-level subcommand grammar. An exotic invocation could reach `git push`.
- Prompt injection in the diff gets past every flag. Running agentic mode only on your own changes covers it.

#### Overage

A separate `$0` stop-usage budget on All AI Credit SKUs blocks billed overage, even though the plan reports `overage_permitted: true` with a 2000-credit overage entitlement.

#### Review Prompt

The script's prompt lists the defect classes in priority order and tells the model to skip summarizing the change. Keep both when editing it.
