import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHandler } from "./server";

let root: string;
let handler: ReturnType<typeof createHandler>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pr-body-label-"));
  await Bun.write(join(root, "samples.json"), JSON.stringify([{ id: "s-1", body: "b" }]));
  handler = createHandler({
    dataPath: join(root, "samples.json"),
    feedbackDir: join(root, "feedback"),
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function request(path: string, body?: unknown): Request {
  return new Request(
    `http://local${path}`,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
}

test.each<{ path: string; type: string }>([
  { path: "/", type: "text/html; charset=utf-8" },
  { path: "/index.html", type: "text/html; charset=utf-8" },
  { path: "/api/samples", type: "application/json" },
])("GET $path serves $type", async ({ path, type }) => {
  const res = await handler(request(path));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe(type);
});

test("GET /api/samples serves the mined samples file", async () => {
  expect(await (await handler(request("/api/samples"))).json()).toEqual([{ id: "s-1", body: "b" }]);
});

test("POST /api/feedback saves the feedback under the sample id, and GET returns it", async () => {
  const feedback = { verdict: "good", tags: [], notes: "", annotations: [] };
  expect((await handler(request("/api/feedback", { id: "s-1", feedback }))).status).toBe(200);
  expect(await Bun.file(join(root, "feedback", "s-1.json")).json()).toEqual(feedback);
  expect(await (await handler(request("/api/feedback"))).json()).toEqual({ "s-1": feedback });
});

test("POST /api/feedback rejects an id outside the id alphabet", async () => {
  const res = await handler(request("/api/feedback", { id: "../s", feedback: {} }));
  expect(res.status).toBe(400);
});

test("an unknown path is a 404", async () => {
  expect((await handler(request("/nope"))).status).toBe(404);
});
