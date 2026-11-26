import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { z } from "zod";
import { Feedback, feedbackEndpoint, readJsonDir, writeJson } from "./label";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eval-corpus-label-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function post(body: unknown): Request {
  return new Request("http://local/api/feedback", { method: "POST", body: JSON.stringify(body) });
}

test("readJsonDir keys by stem and skips unparseable and non-json files", async () => {
  await Bun.write(join(dir, "a.json"), '{"x":1}');
  await Bun.write(join(dir, "torn.json"), '{"x":');
  await Bun.write(join(dir, "note.txt"), "hi");
  expect(await readJsonDir(dir)).toEqual({ a: { x: 1 } });
});

test("readJsonDir reads a missing directory as empty", async () => {
  expect(await readJsonDir(join(dir, "missing"))).toEqual({});
});

test("writeJson refuses an id that would escape the directory", async () => {
  const failure = await writeJson(dir, "../out", {}).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(await Bun.file(join(dir, "..", "out.json")).exists()).toBe(false);
});

test("the draft endpoint saves the feedback field under the sample id and reads it back", async () => {
  const endpoint = feedbackEndpoint(join(dir, "feedback"), Feedback, (body) => body.feedback);
  const res = await endpoint.post(post({ id: "s-1", feedback: { verdict: "good" } }));
  expect(res.status).toBe(200);
  expect(await (await endpoint.get()).json()).toEqual({ "s-1": { verdict: "good" } });
});

test.each<{ name: string; body: unknown }>([
  { name: "path id", body: { id: "../x", feedback: {} } },
  { name: "missing feedback", body: { id: "s-1" } },
])("the draft endpoint rejects a $name with 400", async ({ body }) => {
  const res = await feedbackEndpoint(dir, Feedback).post(post(body));
  expect(res.status).toBe(400);
  expect(await readJsonDir(dir)).toEqual({});
});

test("by default the endpoint saves the whole validated body", async () => {
  const Label = z.object({ id: z.string(), pick: z.enum(["a", "b"]) });
  await feedbackEndpoint(dir, Label).post(post({ id: "p-1", pick: "a" }));
  expect(await Bun.file(join(dir, "p-1.json")).json()).toEqual({ id: "p-1", pick: "a" });
});
