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

## Prior art

Background research (full report in the session) found a convergent design and confirmation of the routing targets.

- Per-item markdown files with YAML front matter is the model every tool that handles a DAG converges on (Backlog.md, taskmd). A single flat manifest (todo.txt) cannot express dependencies, which argues against one big file. taskmd is the closest authoring match: front-matter `dependencies: [ids]` plus a body for human context and a graph command.
- Model both edge directions, store one. Taskwarrior `depends:` with a `blocks:` inverse, and Linear's single directional `blocks`, both store one directed edge and derive the inverse. Validate for cycles at authoring time.
- git-bug is the reference for tracker bridges (incremental, id-mapping, bidirectional). The review-locally-then-push-once model deliberately avoids the two-way reconciliation that every markdown-to-tracker sync (obsidian-github-tasks) punted on. Keep it one-directional at create time, and persist a local-id to remote-id map so nothing double-creates.
- Render the DAG as Mermaid generated from the front-matter edges. It renders in GitHub, in artifacts, and on mobile without a plugin runtime, unlike Dataview which is unreliable on iOS.

## Mobile surface

Research compared four surfaces against the hard requirements: mobile-native, runs on the user's own subscription with no API key, can author local markdown, and can route to GitHub and Linear.

#### Claude Code on web and mobile, primary

The only surface meeting all four. It runs in the cloud from the browser or the Claude mobile app, sessions persist across devices, and it bills against a claude.ai Pro or Max subscription with no API key. The repo is the source of truth, so the markdown authoring, DAG validation, and routing live as a repo skill or plugin and run unchanged. Review-before-push maps onto Plan mode plus inline diff review on the phone. Routing uses bash, the `gh` CLI for GitHub blocked-by, and an MCP server or curl for Linear `issueRelationCreate`. Caveat: research preview, and web permission modes are limited to auto-accept-edits and plan.

#### Claude artifact as a review surface, secondary

An artifact can render the DAG in Mermaid, let you pick which items to route, and use `window.claude.complete` for in-place authoring help, billed to each viewer's own subscription with no key. The constraint: the artifact iframe sandbox blocks arbitrary outbound fetch, so it cannot call GitHub or Linear directly. It produces the reviewed selection and hands off to a Claude Code web session (deep-linked with a prompt parameter) for the authenticated routing. `window.claude.complete` is a thin, sparsely-documented primitive that may change.

#### Cowork and a thin PWA, not primary

Cowork hosts a custom skill or plugin and uses the subscription, but its mobile story is a desktop relay that needs an awake, paired desktop, failing the standalone-mobile requirement. A thin PWA forces a separate API-billed key or self-paid proxying, breaking the on-the-subscription requirement. Reach for the PWA only after outgrowing the first-party surfaces.

## Relationship to dispatch

Dispatch is the push side: the agent autonomously decides to surface something. This tool is the authoring and staging side: a human and agent curate a graph, then push. They share the routing actuators (GitHub `blocked_by`, Linear `blocks`) and the marker and dedup layer. The dispatch task files are a concrete artifact this tool would manage.

## Open directions

- Graph storage: per-item files with front-matter edges is the convergent answer, with the DAG rendered from those edges rather than hand-drawn. Settle whether a thin manifest indexes the items or the files stand alone.
- Local-to-remote identity: front-matter id, a marker in the issue body, or a local lockfile that holds the local-id to remote-id map.
- Whether the primary build is a repo skill or plugin run through Claude Code on web and mobile, with an artifact as an optional review surface layered on top.

## Process notes to carry forward

- The per-task template stabilized fast: goal, context, depends-on, scope, approach, acceptance criteria, references. That template is a candidate schema for the tool's item type.
- Keeping the DAG in sync with the prose `Depends on` fields was the main manual hazard. A single source of truth for edges is a hard requirement.
