---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: github: add a Copilot cross-model review skill

Motivating case: reviewing a change in another repo, Copilot caught a compose function that streamed two files to stdout without checking either read succeeded, a defect two Claude reviewers had missed.

## What changed and why

The Copilot Pro plan is a fixed allowance, so every design choice follows from budget: disable-model-invocation keeps natural-language routing and skill-to-skill delegation from reaching it, and --angles is capped at three with one call by default.

## Out of Scope (Deferred, Not Part of This PR)

The sandbox blocks Copilot from writing to ~/.copilot, so the script throws an empty HOME instead, which leaves the sandbox intact and keeps hooks, instructions, and history out of the review.
