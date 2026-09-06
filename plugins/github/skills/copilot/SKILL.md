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

A second model reads the diff. The point is a different reviewer rather than a better one: Claude re-reading its own work shares the blind spot that produced it. It has already caught an unchecked-failure defect that two Claude review passes both cleared.

## What It Costs

The plan grants 1500 AI credits a month. It resets on the 1st and does not roll over. Four measured facts shape every choice:

- A terra call pays about 3.5 credits before it reads a line of your code, writing 14k tokens of system prompt and tool definitions to cache at 250 credits per million. That is half a median review. A second call is never a rounding error.
- Output costs 6x input and 60x cache_read. Verbose answers run up a bill faster than large diffs.
- Nothing caches between calls. Separate spawns are separate sessions, and each one re-pays its whole prompt at the cache_write rate. Three angles cost three full prompts.
- `gpt-5.6-luna` prices every token class at exactly a tenth of terra.

## Sizing a Review

`--status` prints the current tier and the bands, and spends nothing. Run it when you are unsure whether a change qualifies.

The tier comes from `pace`, credits remaining divided by days to reset. Under 25 is constrained, over 60 is abundant, and everything between is normal. The nominal allowance of 48 a day (1500 over 31) is the yardstick `--status` prints `pace` against, and it decides nothing on its own. The tier sets how strict the bar is, never how much to spend. Manufacturing reviews to use up an allotment is the failure mode this guards against, so credits left unspent in a month where every qualifying change got a full review are the right outcome.

| tier | gate |
| --- | --- |
| constrained | terra only on risk-surface hits, luna one-shot otherwise |
| normal | terra one-shot on gate-worthy changes, skip the rest |
| abundant | terra one-shot on any substantial human change, 3 angles on the risk class, agentic available |

The bands reuse ship's Bot Review Gate criteria, so one set of rules decides both:

| band | criteria | shape | cost |
| --- | --- | --- | --- |
| skip | bot bumps, prose, lockfiles, reverts, config away from the risk surfaces | none | 0 |
| deep | a runtime surface, auth, sandbox, permissions, secrets, or egress; over ~200 lines or 8 files excluding tests, docs, and lockfiles; a bug `review:code` confirmed; a session that drifted | terra, 1 angle | 7.6-12.4 |
| deep+ | risk-surface hits, abundant tier only | terra, 3 angles | ~22.7 |
| agentic | destructive, concurrent, or auth changes, abundant tier only | capped session | up to 60 |

The script enforces the hard stops on its own. It refuses `--agentic` outside the abundant tier, degrades to luna below 150 credits remaining, and refuses any run whose session cap could carry the account into billed overage. A meter it cannot read stops the run, which is what keeps this inert on a machine with no personal Copilot entitlement.

## Arguments

Everything is optional and forwards to the script.

- `--base <ref>`: what to diff against. Defaults to the upstream tracking ref, then `origin/main`.
- `--angles <1-3>`: independent review calls. Defaults to 1. See [Angles](#angles).
- `--model <name>`: see [Models](#models). Defaults to `gpt-5.6-terra`.
- `--agentic`: review from a disposable checkout with tools instead of from inlined text. It is one capped session and refuses `--angles` above 1. See [Agentic Mode](#agentic-mode).
- `--status`: print the tier and bands, spend nothing.
- `--dry-run`: print the assembled prompts and their size, spend nothing.
- `--max-bytes <n>`: raise or lower the 120 KB prompt cap.
- `--force`: run even when a prompt exceeds the size cap.

## Run It

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/copilot/scripts/review.ts [--base <ref>] [--angles <n>] [--model <name>]
```

The script resolves the diff, inlines the changed files, and prints each angle's findings with what it spent and what is left. It refuses a prompt over 120 KB rather than quietly spending on it. Prefer narrowing with `--base`, then `--max-bytes`, over passing `--force`.

## Angles

One angle asks for every defect class in one call, which is the right default. Above that, the script splits the classes so the calls do not overlap, because three identical reviews mostly agree and cost three times as much for one review's worth of coverage.

| angles | coverage |
| --- | --- |
| 1 | every class, one call |
| 2 | unchecked failure and correctness, then data loss and security |
| 3 | adds contracts, concurrency, and resources |

Use 3 only for something security-sensitive, destructive, or concurrent, and only in the abundant tier. It triples the spend and buys no cache discount.

## Agentic Mode

`--agentic` gives Copilot a throwaway `git worktree` checked out at HEAD and lets it use tools. It reads callers, tests, and history instead of only what the prompt carries. That is its one categorical advantage. It runs under a 60-credit cap against a one-shot's 30, and a one-shot in practice lands at 7.6 to 12.4, so budget for several times the cost rather than double. It needs a clean tree, because a worktree at HEAD would otherwise show it code that does not match the diff it was handed.

Reserve it for changes you authored. A diff carrying untrusted third-party text gets the one-shot shape, where the model has no tools and cannot act on anything it reads.

## Triage the Findings

A one-shot finding is a claim from a model that cannot see the repository, so treat it the way you would a review bot rather than an oracle. For each finding, read the actual code and decide:

- **Real** → fix it, or say precisely why you are deferring.
- **Wrong** → say what the model missed. A one-shot review works from inlined text. A finding that depends on a caller or invariant it never saw is a common and expected miss.
- **Unsure** → put it to the user rather than guessing.

Report what you accepted and what you rejected, with the reason in both directions. A silent drop looks identical to a miss.

Never re-run to get a second opinion on a rejected finding. That doubles the spend for a judgment you have already made.

## Models

Rates come from the CLI's own usage ledger, in credits per million tokens:

| model | input | cache_read | cache_write | output |
| --- | --- | --- | --- | --- |
| `gpt-5.6-terra` | 200 | 20 | 250 | 1200 |
| `gpt-5.6-luna` | 20 | 2 | 25 | 120 |

`copilot help config` lists every model name the CLI accepts. That list is the discovery method: there is no `models` subcommand, and the names are not guessable. It is also broader than what this account can reach. A listed name can still come back "not available". Probing costs nothing when a model is rejected, because the CLI fails before inference.

`gpt-5.6-codex` does not exist. The GPT-5.6 family is `sol`, `terra`, and `luna`, and `sol` is not reachable on this plan.

## Gotchas

#### No Prefix Cache Across Calls

Two terra spawns sharing an identical 20k-token prefix both wrote the full prompt and read nothing from cache. Caching works inside one session and not between them. Ordering the prompt to share a prefix across angles therefore buys nothing. Do not build for it without re-probing.

#### The Sandbox and `HOME`

The sandbox blocks Copilot writing to `~/.copilot`, which kills the run with `I/O error: Operation not permitted (os error 1)`. The script points `HOME` at `~/.cache/claude/copilot-home`, which the sandbox allows. Do not solve this by disabling the sandbox. That home persists on purpose. This path's spend lands in a ledger you can read afterward, and `--resume` picks a session back up. `--no-custom-instructions` keeps the repo's own instructions out of the review.

#### Prompt Size

The prompt travels on stdin. Omitting `-p` is what selects that: Copilot reads stdin as the prompt and stays in the same non-interactive mode, so `ARG_MAX` does not bound it. The 120 KB cap is a spend guard rather than a size ceiling. `--max-bytes` moves it, and `--force` runs past it.

#### What Reaches GitHub

The diff and the changed files go to GitHub. That is the whole mechanism, and there is no redaction. A changed file holding a token or a key sends it. Untracked files count. The script unions in `git ls-files --others --exclude-standard` so a pre-commit review does not miss new files, and it inlines their full contents like any other. A symlink out of the repository is the one exclusion, which is why a link to `~/.ssh` inlines nothing. Check what is in the diff before reviewing a change that touches secrets or fixtures.

#### One-Shot Has No Tools

A one-shot run sits outside the repo with no tools, so everything it sees is inlined in the prompt. A finding that assumes it read a file misjudges the mode.

#### Agentic Containment Has Known Gaps

Agentic mode passes `--allow-all-tools` and subtracts from it: `--deny-tool write` and `--deny-tool url`, plus `shell(git push)`, `shell(gh:*)`, `shell(curl:*)`, and `shell(wget:*)`. Deny beats allow, so those six are the boundary. The stack is built to contain misbehavior. It will not hold against a deliberate attacker.

- `--deny-tool write` covers file-writing tools and leaves shell redirection open. The disposable worktree is the actual write barrier.
- That worktree shares the parent's `.git`. A shell write therefore reaches the real repository's refs and config. `git update-ref` moves a branch and `git config` changes repository settings, and neither is denied. The reflog records ref moves.
- The four `shell` denies and `url` close the outbound paths the sandbox cannot, since `github.com` is allowlisted and `gh` credentials resolve.
- Deny matching works on first-level subcommand grammar. An exotic invocation shape reaching `git push` may slip past it.
- Prompt injection in the reviewed diff stays open. The mitigation is the usage rule above rather than a flag.

#### The Guard Holds No Lock

Each invocation reads the meter once and reserves against that reading. Two reviews started at the same moment therefore both clear a reserve only one of them fits in. This script caps the common case. What makes the gap cost nothing is a separate `$0` stop-usage budget on All AI Credit SKUs, which blocks billed overage outright. The plan still reports `overage_permitted: true` with a 2000-credit overage entitlement, because that figure describes plan capability. The budget is what describes billing consent.

#### Default Framing Is Thin

A default framing gets a pass that ignores most of what you asked for. The script's prompt names the defect classes in priority order and forbids summarizing the change back. Keep that if you edit it.
