#!/usr/bin/env bash
set -euo pipefail
mkdir -p web api worker
cat > web/upload.ts <<'TS'
// Runs in the browser.
export async function uploadPhoto(file: File) {
  const { uploadUrl, jobId } = await (await fetch("/api/uploads", { method: "POST" })).json();
  await fetch(uploadUrl, { method: "PUT", body: file });
  await fetch(`/api/uploads/${jobId}/complete`, { method: "POST" });
  return watchJob(jobId);
}

function watchJob(jobId: string) {
  return new EventSource(`/api/jobs/${jobId}/events`);
}
TS
cat > api/uploads.ts <<'TS'
// API server process.
import { queue } from "./queue";
import { signPut } from "./storage";

export async function startUpload() {
  const jobId = crypto.randomUUID();
  return { jobId, uploadUrl: await signPut(`raw/${jobId}`) };
}

export async function completeUpload(jobId: string) {
  await queue.publish("thumbnails", { jobId, key: `raw/${jobId}` });
}
TS
cat > api/queue.ts <<'TS'
// Redis-backed queue shared by the API and the worker.
export const queue = {
  async publish(topic: string, message: object) {},
  async subscribe(topic: string, handler: (m: any) => Promise<void>) {},
};
TS
cat > api/storage.ts <<'TS'
// S3 presigning.
export async function signPut(key: string): Promise<string> {
  return `https://bucket.s3.amazonaws.com/${key}?signature=...`;
}
TS
cat > api/events.ts <<'TS'
// Server-sent events to the browser, fed from the queue's "job-status" topic.
import { queue } from "./queue";

export function streamJob(jobId: string, send: (event: string) => void) {
  return queue.subscribe("job-status", async (m) => {
    if (m.jobId === jobId) send(m.status);
  });
}
TS
cat > worker/thumbnails.ts <<'TS'
// Separate worker process.
import { queue } from "../api/queue";

queue.subscribe("thumbnails", async ({ jobId, key }) => {
  const image = await download(key);
  await upload(`thumbs/${jobId}`, resize(image, 256));
  await queue.publish("job-status", { jobId, status: "done" });
});

declare function download(key: string): Promise<Uint8Array>;
declare function upload(key: string, data: Uint8Array): Promise<void>;
declare function resize(data: Uint8Array, size: number): Uint8Array;
TS
