# reviewr

A herdr plugin that opens a review sidebar over the diff you just wrote and collects line comments on it.

Never query or poll reviewr. When the user hits Send, it injects the comment batch into your input and stops. It does not submit. The comments arrive inside an ordinary user turn, usually with the user's own remarks attached.

## Reading a Batch

Each block takes this shape, ordered by file then line:

```fragment
user/skills/herdr/SKILL.md:41-43
-old line
+new line
the reviewer's text, which may run to several lines
```

- Locate the code by matching the verbatim snippet lines, since your own edits shift the line numbers in the header.
- A ` (removed)` suffix on the header means the comment sits on a deleted line. Its snippet comes from the old side and will not be found in the current file.
- Work through the whole set before replying. Sending clears reviewr's in-memory store, so the batch you received is the only copy.

## What It Touches

reviewr never writes to the worktree, the index, or any branch. Its one write is a baseline ref under `refs/reviewr/turn-base/`. Leave those alone.

Its `last-turn` scope reads the same scraped `agent_status` as [Agent Status](../SKILL.md#agent-status), treating a resting-to-working transition as a turn edge. A turn that finishes inside one poll interval is invisible to it, so a very fast edit can be missing from that view.
