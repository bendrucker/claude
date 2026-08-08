---
name: plan:review
description: >-
  Review how an implementation diverged from its approved plan. Forks a
  clean-context agent over the plan and the diff to surface requirements drift
  and warranted follow-ups. Use at finish time or before opening a PR.
allowed-tools:
  - Agent
---

# Plan Review

Compare what shipped against the plan that was approved. Surface where the implementation drifted and what follow-ups that warrants.

The review runs in a forked agent with a clean context. An implementing session accumulates a justification for every departure as it happens, so drift goes unseen from inside it. A reviewer handed only the plan and the diff judges the delta cold. That outside view is the point: re-emphasizing the same prompt in the implementing context would not substitute for it.

## Fork the Review

Claude Code writes the approved plan to a file under `~/.claude/plans/` and injects that file's path into the session when plan mode exits. That file is the plan. Use the path already in this session's context. If none was injected, the session built against no approved plan and there is nothing to review: say so and stop.

Dispatch a background Agent: `analyst` if your available agent types list it, otherwise `general-purpose`. The review reads two documents and reports. It needs no tool an `analyst` lacks, and an `analyst` spawn arrives without the skill catalog a `general-purpose` one carries. Never `fork`: a fork inherits this session's context and defeats the outside view. The agent starts clean and has no idea where this skill lives, so hand it absolute paths: the plan file, and the rubric `references/divergence.md` resolved against this skill's base directory (that directory is in your context). A bare relative path resolves against the repo root in the agent's context and misses. Tell it to:

- read the plan file.
- work out the base branch this change targets, then diff what shipped against it. The branch's open PR is authoritative (`gh pr view --json baseRefName -q .baseRefName`). With no PR yet, fall back to the repository default (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`). Don't assume `main`: a stacked branch targets its parent. Capture both committed and uncommitted work: `git diff <base>...HEAD`, plus `git diff HEAD` and `git status --short` for anything not yet committed. The review can run mid-implementation, so uncommitted changes are in scope.
- read the rubric it was handed, and return the report that rubric asks for.

Run it on a cheaper model when one is set. The review reasons over two documents, so it does not need the top tier.

## Report

Relay the agent's report: the divergences and their classification, the drift, the ranked follow-ups (fix-before-merge against later), and the verdict. Add nothing of your own. The value is the outside view, not a second opinion filtered back through this context.
