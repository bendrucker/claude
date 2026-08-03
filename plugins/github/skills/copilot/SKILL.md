---
name: github:copilot
description: Get a second-model code review of the current diff from GPT via the Copilot CLI, then triage its findings. Use when a change is worth a cross-model check that Claude reviewing its own work cannot give.
argument-hint: "[--base <ref>] [--model <name>] [--dry-run] [--force]"
disable-model-invocation: true
allowed-tools:
  - Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/copilot-review.ts:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(git status:*)
  - Read
  - Grep
  - Glob
  - Edit
---

# Copilot Review

A second model reads the diff. The point is not a better reviewer, it is a different one: Claude re-reading its own work shares the blind spot that produced it. This has already paid for itself once, catching a `compose` function that streamed two files to stdout without checking either read succeeded, which two Claude passes both cleared.

## Spend This Deliberately

Copilot Pro is a fixed budget and one careless review can eat a visible share of it. That constraint is why this skill exists in the shape it does:

- It is `disable-model-invocation`, so nothing can reach it by natural-language routing or delegation from another skill. `/github:copilot` typed by the user is the only entry point. Do not invoke it because a change "looks worth reviewing" and do not wire it into `ship` or any hook.
- One call by default, three at the absolute most. `--angles` is the only knob and it is capped at 3.
- Copilot itself never fans out. It runs with no tools, no MCP servers, and a working directory outside the repo, so every call is one turn against text inlined in the prompt. Any fan-out is the script's, bounded and countable.
- It reviews a diff, never a repository.
- The script prints the prompt size and the number of billed calls before it spends, and the credits actually used after. Read both out.

## Arguments

Everything is optional and forwards to the script.

- `--base <ref>`: what to diff against. Defaults to the upstream tracking ref, then `origin/main`.
- `--angles <1-3>`: how many independent review calls to make. Defaults to 1. See [Angles](#angles).
- `--model <name>`: see [Models](#models). Defaults to `gpt-5.6-terra`.
- `--dry-run`: print the assembled prompts and their size, spend nothing. Use this when the diff might be large.
- `--force`: run even when a prompt exceeds the size cap.

## Run It

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/copilot-review.ts [--base <ref>] [--angles <n>] [--model <name>]
```

The script resolves the diff, inlines the changed files, runs the Copilot calls concurrently, and prints each angle's findings. It refuses a prompt over 120 KB rather than quietly spending on it. When that happens, prefer narrowing the scope with `--base` over passing `--force`.

## Angles

One angle asks for every defect class in one call, which is the right default. Above that, the script splits the classes so the calls do not overlap, because three identical reviews mostly agree and cost three times as much for one review's worth of coverage.

| angles | coverage |
| --- | --- |
| 1 | every class, one call |
| 2 | unchecked failure and correctness, then data loss and security |
| 3 | adds contracts, concurrency, and resources |

Use 3 only when the change genuinely warrants the max-effort profile: something security-sensitive, destructive, or concurrent. It triples the spend.

## Triage the Findings

The output is a claim from a model that cannot see the repository, so treat it the way you would a review bot rather than an oracle. For each finding, read the actual code and decide:

- **Real** → fix it, or say precisely why you are deferring.
- **Wrong** → say what the model missed. It reviews from inlined text and does not know the surrounding codebase, so a finding that depends on a caller or invariant it never saw is a common and expected miss.
- **Unsure** → put it to the user rather than guessing.

Report what you accepted and what you rejected, with the reason in both directions. A silent drop looks identical to a miss.

Never re-run to get a second opinion on a rejected finding. That doubles the spend for a judgment you have already made.

## Models

Measured on one trivial call each, so treat these as relative rather than absolute:

| model | AI credits | notes |
| --- | --- | --- |
| `gpt-5.6-terra` | 3.89 | default, newest generation |
| `gpt-5.3-codex` | 2.73 | code-tuned, older generation |
| `gpt-5.6-luna` | 0.39 | roughly a tenth the cost, for a cheap look |

`copilot help config` lists every model name the CLI accepts. That list is the discovery method: there is no `models` subcommand, and the names are not guessable. It is also broader than what this account can reach, so a listed name can still come back "not available". Probing costs nothing when a model is rejected, because the CLI fails before inference.

`gpt-5.6-codex` does not exist. The GPT-5.6 family is `sol`, `terra`, and `luna`, and `sol` is not reachable on this plan.

## Gotchas

The sandbox blocks Copilot writing to `~/.copilot`, which kills the run with `I/O error: Operation not permitted (os error 1)`. The script gives it a throwaway empty `HOME` instead, which keeps the sandbox intact. Do not solve this by disabling the sandbox. Auth does not live in `~/.copilot`, so an empty one costs nothing and also keeps hooks, custom instructions, and session history out of the review.

The prompt travels as an argv value, so it is bounded by `ARG_MAX` as well as by cost. The 120 KB cap sits well under both, and a second ceiling at 400 KB refuses even under `--force`, because past that the spawn fails with `E2BIG` and no review runs at all.

**The diff and the changed files go to GitHub.** That is the whole mechanism, and there is no redaction. A changed file holding a token or a key sends it. The script will not follow a symlink out of the repository, so a link to `~/.ssh` inlines nothing, but anything genuinely committed or staged in the tree is fair game. Check what is in the diff before reviewing a change that touches secrets or fixtures.

Copilot runs with no tools and its cwd outside the repo, so it cannot read the code it is reviewing. Everything it sees is inlined in the prompt. A finding that assumes it read a file is confused, not informed.

Default framing gets you a thin pass that ignores most of what you asked for. The script's prompt names the defect classes in priority order and forbids summarizing the change back. Keep that if you edit it.
