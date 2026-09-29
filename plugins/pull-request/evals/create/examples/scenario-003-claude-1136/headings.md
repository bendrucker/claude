---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: herdr: add a discovery-first workspace skill

Gap measurement: the work machine spent 25% of its weekly herdr calls re-probing --help because no skill documented the CLI.

## What changed and why

herdr ships five stable releases in five weeks plus near-weekly previews, so any copied command table would go stale within a release cycle; the skill instead teaches a discovery protocol and states that the CLI wins wherever the two disagree.

## Out of Scope (Deferred, Not Part of This PR)

Removal criterion: the --help re-probe count, tracked via the session index; the skill goes if that count holds steady or the skill goes unloaded for two consecutive weeks.
