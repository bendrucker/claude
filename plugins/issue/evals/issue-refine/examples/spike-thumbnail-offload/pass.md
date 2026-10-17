---
fail: []
---
<issue>
---
title: Decide whether to move thumbnail generation off the upload request
type: spike
---

`UploadHandler.process` calls `generate_thumbnail` inline, adding 300 to 800 ms per image to every upload. Find out whether moving that work to a background worker is worth its cost before building anything.

## Questions

- How much upload latency does an inline-free request save?
- How long until the first thumbnail appears once the work is queued?
- Can it run on the job queue planned in [TEAM-512](https://tracker.example.com/issue/TEAM-512), or does it need its own worker?

## Deliverable

A recommendation with the latency numbers, and an implementation issue if the answer is yes.
</issue>
