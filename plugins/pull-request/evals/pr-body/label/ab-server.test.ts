import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { z } from "zod";
import { createHandler, type Pair } from "./ab-server";

function makePair(overrides: Partial<Pair> = {}): Pair {
  return {
    id: "p-1",
    group: "g",
    case: "scenario-1",
    left: { arm: "candidate", body: "left body" },
    right: { arm: "baseline", body: "right body" },
    ...overrides,
  };
}

let labelsDir: string;
let handler: ReturnType<typeof createHandler>;
beforeEach(async () => {
  labelsDir = await mkdtemp(join(tmpdir(), "pr-body-ab-"));
  handler = createHandler({
    pairs: [makePair()],
    labelsDir,
    now: () => new Date("2026-11-09T00:00:00Z"),
  });
});
afterEach(async () => {
  await rm(labelsDir, { recursive: true, force: true });
});

function label(id: string, body: unknown): Request {
  return new Request(`http://local/api/label/${id}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

test("GET /api/pairs sends the bodies without the arms", async () => {
  const text = await (await handler(new Request("http://local/api/pairs"))).text();
  expect(text).not.toContain("candidate");
  expect(text).not.toContain("baseline");
  expect(JSON.parse(text)).toEqual([
    {
      id: "p-1",
      group: "g",
      case: "scenario-1",
      left: "left body",
      right: "right body",
      label: null,
    },
  ]);
});

test.each<{ choice: "left" | "right" | "tie"; winner: string }>([
  { choice: "left", winner: "candidate" },
  { choice: "right", winner: "baseline" },
  { choice: "tie", winner: "tie" },
])("POST $choice saves the label unblinded with winner $winner", async ({ choice, winner }) => {
  const res = await handler(label("p-1", { choice, reasons: ["clearer"], note: "" }));
  expect(res.status).toBe(200);
  expect(await Bun.file(join(labelsDir, "p-1.json")).json()).toEqual({
    id: "p-1",
    group: "g",
    case: "scenario-1",
    choice,
    reasons: ["clearer"],
    note: "",
    winner,
    left: "candidate",
    right: "baseline",
    at: "2026-11-09T00:00:00.000Z",
  });
});

test("a saved label comes back with its pair", async () => {
  await handler(label("p-1", { choice: "tie", reasons: [], note: "same" }));
  const served = z
    .array(z.object({ label: z.unknown() }))
    .parse(await (await handler(new Request("http://local/api/pairs"))).json());
  expect(served[0]?.label).toMatchObject({ id: "p-1", choice: "tie", note: "same" });
});

test.each<{ name: string; id: string; body: unknown; status: number }>([
  { name: "unknown pair", id: "p-9", body: { choice: "left", reasons: [], note: "" }, status: 404 },
  { name: "invalid choice", id: "p-1", body: { choice: "up", reasons: [], note: "" }, status: 400 },
])("POST with an $name answers $status and saves nothing", async ({ id, body, status }) => {
  expect((await handler(label(id, body))).status).toBe(status);
  expect(await Bun.file(join(labelsDir, `${id}.json`)).exists()).toBe(false);
});
