---
name: candidates
description: Use when asked to find, survey, or rank refactoring targets in a codebase, such as hand-rolled code a library or runtime built-in should replace, large modules with several responsibilities, or duplicated logic. Produces a ranked report with run-verified behavior differences and changes no code. To carry out a pick, use port or split.
argument-hint: "[--mode upstream|split|dedupe] [<repo or path>...]"
---

# Candidates

Survey `$ARGUMENTS`, or the repositories the user named, for refactors worth doing, and rank them. Someone reads the report, picks rows, and hands each to the skill that executes it. A row earns its place with facts checked against the code: where it is, what the replacement does differently when run, what it removes, and what a port must prove. A list of smells is not a report.

The work ends at the report. Leave source, tests, manifests, and lockfiles unchanged. Put probe scripts in a temp directory outside the repository.

## Arguments

- `--mode`: survey one mode. Default: all three.
- Paths or repositories: what to survey. Default: the current repository. When several repositories are named, prefix each location with its repository.

## Modes

| Mode | Target | Executed by |
| --- | --- | --- |
| upstream | Hand-rolled code that the standard library, a runtime built-in, or a maintained package should replace | `port`, through its `references/upstream.md` |
| split | A large module holding several responsibilities | `split` |
| dedupe | The same logic copied into several places | `port`, through its `references/dedupe.md` |

When duplicated copies reimplement a solved problem such as escaping, parsing, or retries, file the row under upstream. Once every copy calls the library, nothing is left to share.

## Find

Read [references/search.md](references/search.md) before searching. It holds the per-mode searches.

- Inventory what the project already has before naming a replacement: the manifest and lockfile, the runtime's minimum version, and the type-check or compile target for each directory (`tsconfig` `lib`, `target`, `requires-python`, `go.mod`). A replacement already used elsewhere in the repository is the strongest and lowest-risk candidate. A built-in absent from one directory's target keeps that directory's copy.
- Search by behavior as well as by text. Copies get renamed, restyled, and reordered. Search for what the code does: the literal it matches, the error it throws, the shape of its loop.
- Use size and churn to aim. A large file nobody touches is a weak split target. A small file that changes every week can be a strong one.
- Count copies. A pattern copied into five files outranks one copy.

## Verify

For each row you rank, run the hand-rolled code and its replacement on the same probe inputs and record every difference. Write each difference as a finding: the input, what the old code returns, what the new code returns. Mark it verified with the runtime and version it ran on. A difference that was not run is labeled unverified, never stated as fact.

- **Upstream.** Probe the edges of the format or protocol: empty input, metacharacters, a leading digit or dash, unicode, CRLF, unclosed or malformed input. Compare what callers observe, such as whether a built regex matches, rather than intermediate text. A replacement can differ byte for byte and still match the same strings.
- **Dedupe.** Run every copy on the union of inputs their callers pass. Each disagreement between copies is drift (one copy is wrong or stale) or variation (callers need different behavior). Name which copy differs and on what input.
- **Split.** Measure the surface a split must keep: the exported names, the importers of each, work done at import time, paths that config, tests, or CI name, and whether the proposed module names are already taken in that directory.

## Rank

Order rows by what they remove against what they risk.

- **Value**: lines removed, copies collapsed, and for split, churn, since every later change to the file pays for its size.
- **Risk**: Low when no verified difference reaches a caller. Medium when a test pins the old output or a caller sees a changed value. High when no drop-in exists and the gain needs a design change, such as passing argv arrays instead of quoting for a shell.

For each ranked row, name the parity harness its port needs: the probe inputs, what to compare, and which tests pin the old behavior. The executing skill builds that harness first.

## Reject

Put every candidate you examined and did not rank on a rejected list with its reason. Apply the keep criteria in port's [`upstream.md`](../port/references/upstream.md#decide). Reasons past surveys used:

- **Domain grammar.** The code parses a format specific to the project, such as units no library knows. A library covers less than the code does.
- **Semantic mismatch.** The closest library differs where callers depend on the old behavior, as when a glob library lets `*` stop at `/`.
- **Deliberately narrow.** The code handles a subset on purpose, such as stripping only one class of escape sequence.
- **Packaging boundary.** The copies live in units that cannot share code, such as separately published packages or independently installed plugins. A merge needs a new shared package, so say what that costs.
- **Parameters exceed savings.** Merging the copies needs more parameters than the lines it removes.
- **One responsibility.** A file is large but holds one thing, such as a data table, generated code, or one state machine.

## Report

Write the report in the shape [references/layout.md](references/layout.md) gives. When the user names a path, write it there. Otherwise put it in the reply. Each ranked row carries:

- every location, as `path:line`;
- what is hand-rolled, or the responsibilities to split, or the copies to merge;
- the replacement, the proposed cut, or the shared version's home;
- lines removed;
- risk;
- the verified differences;
- the parity harness;
- the skill that executes it.

Close with the rejected list, then the top picks as hand-offs, one line each, naming the executing skill and its target.

## Done

The survey is done when:

- Every requested mode has been searched across every named repository.
- Every ranked row has each field above, and every difference it states was run or is labeled unverified.
- Every examined candidate is either ranked or on the rejected list with a reason.
- `git status` in each repository shows no change from the survey.

Stop at the report. Start a port or split only when the user picks a row.
