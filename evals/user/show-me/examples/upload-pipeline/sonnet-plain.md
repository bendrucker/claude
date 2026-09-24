---
fail: [diagram-parties, sequence-diagram, short-close]
---
Here's the full path, traced through the actual code (this is a small, mostly-skeletal repo — 6 files, with several stub functions I'll flag as I go).

## The pipeline

```
web/upload.ts:uploadPhoto()
  1. POST /api/uploads               → api/uploads.ts:startUpload() → api/storage.ts:signPut()
  2. PUT <presigned URL>              → direct browser → S3 (key: raw/{jobId})
  3. POST /api/uploads/{id}/complete  → api/uploads.ts:completeUpload() → queue.publish("thumbnails", ...)
  4. EventSource /api/jobs/{id}/events → api/events.ts:streamJob() → queue.subscribe("job-status", ...)

worker/thumbnails.ts (separate process)
  queue.subscribe("thumbnails") → download(raw/{jobId}) → resize() → upload(thumbs/{jobId})
    → queue.publish("job-status", { jobId, status: "done" })
```

## Step by step

**1. Browser → API** (`web/upload.ts:2-7`)
`uploadPhoto(file)` calls `POST /api/uploads`, getting back `{ uploadUrl, jobId }`.

**2. Browser → S3 directly** (`web/upload.ts:4`)
It then does `PUT` straight to `uploadUrl` with the raw file bytes. This is a **presigned-URL upload** — the API server never touches the file body. The URL comes from `signPut(`raw/${jobId}`)` in `api/storage.ts:2-4`.

**3. API hands off to worker via queue** (`api/uploads.ts:10-12`)
Once the browser's S3 PUT succeeds, it calls `POST /api/uploads/{jobId}/complete`, which runs `completeUpload(jobId)`. That function doesn't touch S3 or a database — it just publishes `{ jobId, key: "raw/{jobId}" }` onto a `"thumbnails"` queue topic (`api/queue.ts`).

**4. Thumbnail worker** (`worker/thumbnails.ts:4-8`)
A separate worker process subscribes to `"thumbnails"`. On a message it: `download(key)` the raw image, `resize(image, 256)`, `upload(thumbs/{jobId}, ...)`, then publishes `{ jobId, status: "done" }` onto a `"job-status"` topic. Trigger is a **queue message**, not a native S3 event notification or a poll loop.

**5. Browser hears "done"** (`web/upload.ts:9-11`, `api/events.ts:4-8`)
Back in the browser, `watchJob(jobId)` opens an `EventSource` on `/api/jobs/{jobId}/events`. Server-side, `streamJob(jobId, send)` subscribes to `"job-status"` and forwards matching messages to that stream. So completion is delivered via **Server-Sent Events**, not websockets or polling.

## Caveats — what's stubbed, not real

- No HTTP router (Express/Fastify/etc.) actually wires these handler functions to the routes the frontend calls — only the handler logic exists.
- `api/queue.ts`'s `publish`/`subscribe` are empty stubs (comment says "Redis-backed," but no Redis client code exists).
- `signPut` in `api/storage.ts` returns a hardcoded string; `download`/`upload`/`resize` in the worker are ambient `declare function`s with no implementation.
- There's no database anywhere in the repo — no upload record is created or updated at any stage.

So architecturally it's a clean presigned-upload + queue-driven-worker + SSE-notify design, but the plumbing (HTTP routing, real queue, real S3 calls, persistence) is all left as stubs in this codebase.
