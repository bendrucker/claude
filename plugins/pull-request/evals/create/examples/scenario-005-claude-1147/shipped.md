---
fail: [heading-question, generic-heading]
---
Title: github: add a Copilot cross-model review skill

Adds `/github:copilot`, a cross-model review of the current diff through the Copilot CLI.

The case for it is a defect it already caught. Reviewing a change in `bendrucker/dotfiles`, Copilot ran alongside two Claude reviewers and was the only one to notice a `compose` function that streamed two files to stdout without checking either read succeeded, which could install a config file missing its entire upstream half. A model re-reading its own work shares the blind spot that produced it, and no amount of re-reading fixes that.

## The Budget Shapes Everything

The Copilot Pro plan is a fixed allowance that one high fan-out review over a large repository would exhaust. Every design choice here follows from that:

- **`disable-model-invocation`.** Natural-language routing and skill-to-skill delegation cannot reach it, so `ship`, `review:peer`, and a stray "this looks worth reviewing" all bounce off. A typed `/github:copilot` is the only entry point. It also means the skill costs zero recurring context when unused. Nothing was added to `~/.claude/CLAUDE.md`, deliberately, since an entry there invites the automatic invocation this is built to prevent.
- **One call by default, three at most.** `--angles` is the only knob and is capped at 3.
- **Copilot itself never fans out.** No tools, no MCP servers, working directory outside the repo, everything inlined in the prompt. Each call is one turn against text. Any fan-out is the script's, bounded and countable.
- **Diff-scoped, never whole-repo.** A 120 KB prompt cap refuses rather than quietly spending, and a second ceiling at 400 KB holds even under `--force`.
- **Cost is visible at the call site.** Prompt size and billed-call count print before the spend, per-call credits after, with a total across angles.

## Reaching GPT-5.6

The target was `gpt-5.6-codex`. It does not exist, and neither do the other names probed while scoping this. The CLI has no `models` subcommand, but `copilot help config` enumerates every accepted name, which turns discovery from guesswork into a lookup.

The GPT-5.6 family is `sol`, `terra`, and `luna`. Probing which are actually entitled costs nothing, because a rejected model fails before inference with the same error as a nonsense string. On this account `terra` and `luna` work, `sol` does not, and `gpt-5.3-codex` is the only reachable codex variant. Measured on one trivial call each:

| model | AI credits |
| --- | --- |
| `gpt-5.6-terra` | 3.89 |
| `gpt-5.3-codex` | 2.73 |
| `gpt-5.6-luna` | 0.39 |

`terra` is the default. So the earlier read that `gpt-5.4` was the only reachable GPT-5.x was wrong: the probes had used names the CLI never offered.

## Angles Are Disjoint

Above one angle the script splits the defect classes rather than repeating the review, because three identical passes mostly agree and cost three times as much for one pass worth of coverage. Two angles cover unchecked failure and correctness, then data loss and security. Three adds contracts, concurrency, and resources.

## What the Tool Found in Itself

Both passes were run against this branch, and the findings are why several of these guards exist.

The single-angle pass caught two defects in the first draft. Paths were parsed as newline-delimited text, so with the default `core.quotePath` a file named `café.ts` came back quoted and escaped, failed to stat, and was silently treated as deleted. And changed files were read through symlinks with no containment check, so a repository linking to `~/.ssh` would have inlined a private key into a prompt bound for a third party. Fixed with `-z` throughout and a `realpathSync` containment test, which also handles the in-repo relative links a dotfiles checkout is full of.

The three-angle pass found four more, one per angle plus a duplicate class. `--max-bytes` was never validated, so a non-numeric value produced `NaN` and every comparison against it went false, disabling the cap entirely. `--base` reached git unverified, so `--base=--output=/tmp/x` turned a diff into a file write. `--force` bypassed the only size guard even though the prompt travels as an argv value, trading a clear refusal for an opaque `E2BIG`. And content accumulated with no running total, so many small files could each pass the per-file cap and still blow the prompt together.

All four are fixed and the guards are exercised directly. One finding was accepted rather than fixed: the diff and changed-file contents go to GitHub with no redaction, which is the mechanism rather than a bug, and is now documented as something to check before reviewing a change that touches secrets.

## Notes

The sandbox blocks Copilot writing to `~/.copilot`, which kills a run with `I/O error: Operation not permitted`. The script gives it a throwaway empty `HOME` instead, leaving the sandbox intact. Auth turns out not to live there, so an empty one costs nothing and also keeps hooks, custom instructions, and session history out of the review.

Default framing returns a thin pass that ignores most of what it was asked. The prompt names the defect classes in priority order and forbids summarizing the change back, which is what produced the findings above.

The skill sits in `github` rather than `review` because the vendor mechanics belong with the platform, leaving the review workflows vendor-free.
