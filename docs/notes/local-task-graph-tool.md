# Local Task Graph Authoring

Scratch notes on a transient branch, to extract into a separate issue. Not part of the dispatch deliverable. Captured because this idea generalizes directly from the dispatch work.

## The idea

Local markdown files as the source of truth for todos and a task graph with dependencies. An agent helps author and revise them locally, then routes selected items out to task trackers (GitHub issues with `blocked_by`, Linear with `blocks`). The human reviews and revises the whole set locally before anything remote is created. A Claude surface drives the authoring, and the surface must work on mobile, since the ideation often happens on a phone.

## This session is a worked example

What we just did by hand is the tool, performed manually:

- Decomposed a spec into one markdown file per task under `docs/tasks/`.
- Encoded a dependency graph through `Depends on` fields plus a Mermaid DAG.
- Grouped tasks into milestones.
- Lined each file up to become a GitHub issue with a parent-context link, after a local review pass.

The friction points are the requirements:

- I authored a dozen files by hand against a repeated template. A tool would scaffold them from the schema.
- The graph lives in prose (`Depends on`) and a separately hand-drawn DAG that can drift apart. A tool would hold one graph and render the views.
- Identity and dedup (the `Session` and fingerprint markers) were conventions I applied by hand. A tool would manage local-to-remote identity.
- Routing to GitHub versus Linear is a per-item decision. A tool would batch it and preview the result before filing.
- There is no local review surface. I commit and you read on the branch. The tool wants an interactive review and revise surface, ideally on mobile.

## Requirements distilled

- Markdown is the source of truth, human-editable, diffable, git-friendly.
- A task graph with typed edges (at least blocks and blocked-by), authored and queried locally.
- Multi-tracker routing that maps the local graph's edges onto each tracker's native dependency primitive: GitHub `blocked_by` (GA Aug 2025) and Linear `issueRelationCreate` with `type: blocks`.
- Local-first review: see and revise every item and edge before creating anything remote, with bulk edit.
- Idempotent, dedup-aware filing: a local item maps to at most one remote issue, and re-filing updates rather than duplicates. Reuse the marker and fingerprint pattern from `improve-claude-code`.
- A Claude authoring and review surface.
- Mobile access.

## Architecture directions to evaluate

#### Cowork plugin or skill

Gives a Claude surface that drives the markdown and the graph and calls the trackers. Open question is the mobile story for Cowork.

#### Web app via Claude artifacts

An artifact can be a mobile-friendly interactive surface that makes agent calls on the user's subscription. It could render the task graph, allow edits, preview the issues that would be created, then trigger filing. This is the most promising mobile path and matches the stated basic requirement: a mobile-friendly web surface with access to agent calls on the subscription.

#### Relationship to dispatch

Dispatch is the push side: the agent autonomously decides to surface something. This tool is the authoring and staging side: a human and agent curate a graph, then push. They share the routing actuators (GitHub `blocked_by`, Linear `blocks`) and the marker and dedup layer. The dispatch task files are a concrete artifact this tool would manage.

## Open directions

- Graph storage: one manifest file, or front matter spread across many task files. This session used many files plus a separate DAG, which drifts. A single manifest with rendered views may be better.
- Local-to-remote identity: front-matter id, a marker in the issue body, or a local lockfile.
- Mobile surface: artifacts versus Cowork versus a thin PWA, and the feasibility of agent calls on the subscription from each.
- Prior art: pending background research (local markdown task tools and local-first issue trackers that sync to GitHub or Linear).

## Process notes to carry forward

- The per-task template stabilized fast: goal, context, depends-on, scope, approach, acceptance criteria, references. That template is a candidate schema for the tool's item type.
- Keeping the DAG in sync with the prose `Depends on` fields was the main manual hazard. A single source of truth for edges is a hard requirement.
