---
fail: [headings-3, no-h1, heading-sentence, heading-title-case, jargon, over-structured, option-menu, summary-heading, type-spike, relations]
---
<issue>
---
title: Evaluate per-chat database workspace
type: feature
---

# Workspace evaluation

## Summary

Object storage becomes the seam for per-chat state.

## Background

Today each request opens a fresh in-memory database.

## Approach options

- File-backed workspace
- In-memory per request

## What should we measure?

Load time and write conflicts.

## Open Questions

None yet.

## Acceptance Criteria

A recommendation.
</issue>
