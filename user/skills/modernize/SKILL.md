---
name: modernize
disable-model-invocation: true
description: Survey a project for ways to adopt newer language and major-dependency features that did not exist when the code was written, replacing boilerplate with modern idioms. Use when the user wants to modernize a codebase, adopt new language features, retire dependencies the stdlib now subsumes, or catch a project up to current framework APIs.
---

# Modernize

Find where a project still does things the old way because newer features did not exist when it was written, and propose semantics-preserving swaps. The deliverable is a **ranked survey of candidates** the user picks from. Applying is a separate phase, run only on the candidates they choose.

Language-agnostic by design. Detect the stack, never assume it.

## Modernization axes

Two axes, plus a third that is easy to miss:

- **Language features.** Syntax and stdlib additions that replace boilerplate: pattern matching, comprehensions, `async`/`await` over callbacks, records and dataclasses, native nullability, structured concurrency.
- **Major dependencies.** Framework and major-library APIs that supersede older usage, such as a new router, data-fetching primitive, or config format. Frameworks and load-bearing libraries only, not every transitive dependency.
- **Stdlib subsumption.** A third-party dependency the language or runtime has since absorbed, like native `fetch`, `structuredClone`, `Array.prototype.flat`, or `std::format`. Retiring a now-redundant dependency is the highest-leverage move, because it deletes code and a dependency at once.

## Three disciplines

These separate modernization from churn. Hold them throughout.

1. **Semantics-preserving.** A modernization changes *how* the code is written, never *what it does*. Behavior, public API, and error modes stay identical. A swap that would change behavior is a feature change, and belongs in the report only as a flagged note.

2. **Earn its keep.** Newer is not a reason. Every candidate must buy something concrete: less boilerplate, stronger types or safety, a dropped dependency, real performance, or genuine clarity. Pure novelty is rejected. Churn has a cost (review burden, blame noise, risk) and the benefit must clear it.

3. **Respect the floor.** A project has a *minimum supported version*: the oldest runtime or language version it promises to run on (an app's deploy target, a library's declared `engines`, edition, or `*_requires`). A feature newer than the floor cannot be adopted for free. Adopting it silently raises the floor and breaks consumers. Those candidates are **flagged bumps**, reported separately with the version they require, never applied as part of adopt-now. See [references/survey.md](references/survey.md).

## Process

### 1. Detect stack and floor

Identify every language, its targeted or minimum version, and the major dependencies with their versions. Read manifests, not vibes. The cross-ecosystem cheat-sheet is in [references/detect.md](references/detect.md). Record, per language and major dependency, the floor and the current version installed or resolvable. The gap between them is the modernization budget.

### 2. Research the gap

Do not trust memory for "added in version X." Web-research the changelogs and release notes between the floor and current, for the language and each major dependency, and ground every claim in a dated source. Prefer official codemods and migration guides where they exist. Method and sourcing rules in [references/research.md](references/research.md).

### 3. Survey the code

Scan for the old patterns the researched features replace. Fan out with `Agent`/`Explore` for breadth on a large codebase. Each candidate maps a concrete code location to a specific feature, with a before and after. Apply the three disciplines as a filter before a candidate makes the list.

### 4. Present the survey

Group candidates by axis, rank within each group by leverage, and mark each as adopt-now or a flagged bump with a recommendation strength. Format and template in [references/survey.md](references/survey.md). Then ask which to apply. **Do not edit code in this phase.**

### 5. Apply (follow-up)

Only the picked candidates. Prefer official codemods over hand-edits. Work in small batches, run the project's own build, test, and lint after each, and commit per coherent batch. Verification and batching rules in [references/apply.md](references/apply.md).

## Gotchas

- **A short survey is a success.** A modern, well-kept project yields few candidates. Report that honestly. Padding the survey with lateral restyling violates earn-its-keep and trains the user to distrust it.
- **Detect the real runtime before assuming a language floor.** A Bun or Deno project has no `engines.node`. Bun implements `node:fs`, `child_process`, and friends, so swapping them for `Bun.file`/`Bun.$` is lateral churn rather than a version-gap fix. See [references/detect.md](references/detect.md).
- **Read the floor from the manifest range.** A lockfile often resolves a dependency far above the declared minimum. A feature the resolved version supports but the floor does not is a flagged bump, because adopting it raises the floor.
- **No declared floor still has a budget.** A `private` app targeting `esnext` with no `engines` has its local toolchain as the floor. The work is idiom adoption (the code predates features its own target already allows), and raising the floor costs nothing because there are no consumers.
- **Deprecation is a benefit. Availability alone is not.** If the old API is not deprecated and the swap buys nothing concrete, leave it. An API on a deprecation clock is worth migrating. A merely newer spelling of a working API is not.

## Arguments

`$ARGUMENTS` is an optional scope or focus hint: a path to confine the survey (`src/api`), a language to target in a polyglot repo (`typescript`), or a dependency to center on (`react`). With no argument, survey the whole project.
