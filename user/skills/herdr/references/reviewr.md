# reviewr

A herdr plugin. It opens a review sidebar over the diff you just wrote and collects line comments on it.

## Direction

The contract runs one direction, and misreading that direction is the main way to get this wrong. You never query reviewr. You never poll it. When the user hits Send, reviewr injects the comment batch into your input and stops there. It does not submit. So the comments arrive as part of an ordinary user turn, usually with the user's own remarks attached.

## Reading a Batch

Each block takes this shape, ordered by file then line:

```fragment
user/skills/herdr/SKILL.md:41-43
-old line
+new line
the reviewer's text, which may run to several lines
```

- Locate the code by matching the verbatim snippet lines. Your own edits shift line numbers, which makes the snippet the reliable anchor and the header a hint.
- A ` (removed)` suffix on the header means the comment sits on a deleted line. Its snippet comes from the old side and will not be found in the current file.
- Sending clears reviewr's list, and the store is in memory only. The batch you receive is the only copy, so work through the whole set rather than acting on the first few.

## What It Touches

reviewr never writes to the worktree, the index, or any branch, which rules it out as the explanation for an unexpected diff. Its one write is a baseline ref under `refs/reviewr/turn-base/`, deliberately outside `refs/heads`. Leave those alone.

Its `last-turn` scope reads the same scraped `agent_status` as [Agent Status](../SKILL.md#agent-status), treating a resting-to-working transition as a turn edge. A turn that finishes inside one poll interval is invisible to it, which is why a very fast edit can be missing from that view.
