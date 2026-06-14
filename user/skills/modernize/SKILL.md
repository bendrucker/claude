---
name: modernize
disable-model-invocation: true
description: Survey a project for ways to adopt newer language and major-dependency features that did not exist when the code was written, replacing boilerplate with modern idioms. Use when the user wants to modernize a codebase, adopt new language features, retire dependencies the stdlib now subsumes, or catch a project up to current framework APIs.
---

# Modernize

Find where a project still does things the old way because newer features did not exist when it was written, and propose semantics-preserving swaps. The deliverable is a **ranked survey of candidates** the user picks from. Applying is a separate phase, run only on the candidates they choose.

Language-agnostic by design. Detect the stack, never assume it.

## What counts as modernization

Two axes, plus a third that is easy to miss:

- **Language features** — syntax and stdlib additions that replace boilerplate (pattern matching, comprehensions, `async`/`await` over callbacks, records/dataclasses, native nullability, structured concurrency).
- **Major dependencies** — framework and major-library APIs that supersede older usage (a new router, a new data-fetching primitive, a config format). Only frameworks and load-bearing libraries, not every transitive dependency.
- **Stdlib subsumption** — a third-party dependency the language or runtime has since absorbed (native `fetch`, `structuredClone`, `Array.prototype.flat`, `std::format`). Retiring a now-redundant dependency is the highest-leverage modernization available, because it deletes code *and* a dependency.

## Three disciplines

These are what separate modernization from churn. Hold them throughout.

1. **Semantics-preserving.** A modernization changes *how* the code is written, never *what it does*. Behavior, public API, and error modes stay identical. If a swap would change behavior, it is a feature change, not a modernization, and belongs in the report only as a flagged note.

2. **Earn its keep.** Newer is not a reason. Every candidate must buy something concrete: less boilerplate, stronger types or safety, a dropped dependency, real performance, or genuine clarity. Pure novelty is rejected. Churn has a cost (review burden, blame noise, risk) and the benefit must clear it.

3. **Respect the floor.** A project has a *minimum supported version* — the oldest runtime or language version it promises to run on (an app's deploy target, a library's declared `engines`/edition/`*_requires`). A feature that is newer than the floor cannot be adopted for free: doing so silently raises the floor and breaks consumers. Such candidates are **flagged bumps**, reported separately with the version they would require, never applied as part of "adopt now." See [references/survey.md](references/survey.md).

## Process

### 1. Detect the stack and the floor

Identify every language, its targeted/minimum version, and the major dependencies with their versions. Read manifests, not vibes. The cross-ecosystem cheat-sheet is in [references/detect.md](references/detect.md). Record, per language and major dependency: the floor, and the current version actually installed or resolvable. The gap between them is the modernization budget.

### 2. Research what's new in the gap

Do not trust memory for "added in version X." Web-research the changelogs and release notes between the floor and current, for the language and each major dependency, and ground every claim in a dated source. Prefer official codemods and migration guides where they exist. Method and sourcing rules in [references/research.md](references/research.md).

### 3. Survey the code for candidates

Scan for the old patterns the researched features replace. Fan out with `Agent`/`Explore` for breadth on a large codebase. Each candidate maps a concrete code location to a specific feature, with a before/after. Apply the three disciplines as a filter before a candidate makes the list.

### 4. Present the ranked survey, then stop

Group candidates by axis, rank within group by leverage, and mark each with a recommendation strength and whether it is adopt-now or a flagged bump. Format and the report template are in [references/survey.md](references/survey.md). Then ask which the user wants to apply. **Do not edit code in this phase.**

### 5. Apply the chosen candidates (follow-up)

Only the picked candidates. Prefer official codemods over hand-edits. Work in small batches, run the project's own build/test/lint after each batch to confirm behavior held, and commit per coherent batch. The verification and batching rules are in [references/apply.md](references/apply.md).

## Arguments

`$ARGUMENTS` is an optional scope or focus hint — a path to confine the survey (`src/api`), a language to target in a polyglot repo (`typescript`), or a dependency to center on (`react`). With no argument, survey the whole project.
