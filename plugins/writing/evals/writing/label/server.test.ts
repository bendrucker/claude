import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { z } from "zod";
import type { Label, Pair } from "../../authoring/scripts/pairs";
import { computeLeft, createHandler } from "./server";

function makePair(overrides: Partial<Pair> = {}): Pair {
  return {
    id: "p-001",
    case: "case-1",
    surface: "pr",
    brief: "write a PR body",
    a: { source: { kind: "run", column: "base", arm: "dev", run: 0 }, text: "draft a text" },
    b: { source: { kind: "original", url: "https://example.com/pr/1" }, text: "draft b text" },
    ...overrides,
  };
}

const PairsPayload = z.array(z.object({ a: z.looseObject({}), b: z.looseObject({}) }));

let root: string;
let pairsDir: string;
let feedbackDir: string;
let handler: ReturnType<typeof createHandler>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "writing-labeler-"));
  pairsDir = join(root, "pairs");
  feedbackDir = join(root, "feedback");
  await mkdir(pairsDir, { recursive: true });
  await mkdir(feedbackDir, { recursive: true });
  await Bun.write(join(pairsDir, "p-001.json"), JSON.stringify(makePair()));
  handler = createHandler({ dataPath: join(root, "unused.json"), pairsDir, feedbackDir });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test.each<{ id: string; expected: "a" | "b" }>([
  { id: "p1", expected: "b" },
  { id: "p2", expected: "a" },
  { id: "abc", expected: "a" },
  { id: "xyz", expected: "b" },
])("computeLeft($id) is deterministic and equals $expected", ({ id, expected }) => {
  expect(computeLeft(id)).toBe(expected);
  expect(computeLeft(id)).toBe(computeLeft(id));
});

test("GET /api/pairs omits source from the browser payload", async () => {
  const res = await handler(new Request("http://local/api/pairs"));
  const text = await res.text();
  expect(text).not.toContain("source");

  const pairs = PairsPayload.parse(JSON.parse(text));
  expect(pairs[0]?.a.source).toBeUndefined();
  expect(pairs[0]?.b.source).toBeUndefined();
});

test("POST /api/labels accepts a valid Label and writes it to feedback/<id>.json", async () => {
  const label: Label = { id: "p-001", pick: "a", left: "a", spans: [], notes: "clean" };
  const res = await handler(
    new Request("http://local/api/labels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(label),
    }),
  );
  expect(res.status).toBe(200);
  expect(await Bun.file(join(feedbackDir, "p-001.json")).json()).toEqual(label);
});

test("POST /api/labels rejects an invalid Label", async () => {
  const res = await handler(
    new Request("http://local/api/labels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "p-002", pick: "not-a-real-pick", left: "a" }),
    }),
  );
  expect(res.status).toBe(400);
});
