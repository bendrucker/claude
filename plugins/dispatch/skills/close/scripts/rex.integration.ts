import { afterAll, beforeAll, expect, test } from "bun:test";
import { z } from "zod";
import { spawnRunner } from "../../dispatch/scripts/dispatch";
import { currentSession } from "../../dispatch/scripts/sessions";
import { rex } from "./rex";

// Drives the local Rex server and its connected app. Run with
// `bun test ./plugins/dispatch/skills/close/scripts/rex.integration.ts`.

const Created = z.object({
  session_id: z.string(),
  initial_windows: z.array(z.object({ window_id: z.string(), block_ids: z.array(z.string()) })),
});
const Split = z.object({ block_ids: z.array(z.string()).min(1) });
const Window = z.object({
  layers: z.array(
    z.object({ state: z.string().nullish(), blocks: z.array(z.object({ block_id: z.string() })) }),
  ),
});

async function rexJson<T>(schema: z.ZodType<T>, argv: string[]): Promise<T> {
  const result = await spawnRunner(["rex", ...argv]);
  if (result.code !== 0) throw new Error(`rex ${argv.join(" ")}: ${result.stderr}`);
  return schema.parse(JSON.parse(result.stdout));
}

let session = "";
let window = "";
let parked = "";

beforeAll(async () => {
  const created = await rexJson(Created, [
    "new",
    `close-integration-${process.pid}`,
    "--json",
    "--",
    "sleep",
    "300",
  ]);
  session = created.session_id;
  const first = created.initial_windows[0];
  window = first?.window_id ?? "";
  const anchor = first?.block_ids[0] ?? "";
  const split = await rexJson(Split, [
    "split",
    "-s",
    session,
    "-b",
    anchor,
    "--focus=false",
    "--json",
    "--",
    "sleep",
    "300",
  ]);
  parked = split.block_ids[0] ?? "";
});

afterAll(async () => {
  if (session !== "") await spawnRunner(["rex", "kill", session]);
});

async function stateOf(block: string): Promise<string | null | undefined> {
  const inspected = await rexJson(Window, ["window", "inspect", "-s", session, window, "--json"]);
  return inspected.layers.find((layer) => layer.blocks.some((b) => b.block_id === block))?.state;
}

test("the block names its session without REX_SESSION", async () => {
  expect(await currentSession({ REX_BLOCK: parked }, spawnRunner)).toBe(session);
});

test("parks and restores a pane from REX_BLOCK alone, marking its tab unread", async () => {
  const mux = rex({ env: { REX_BLOCK: parked }, cwd: process.cwd(), run: spawnRunner });
  await mux.parkPane?.(parked);
  expect(await stateOf(parked)).toBe("minimized");
  await mux.restorePane?.(parked);
  expect(await stateOf(parked)).not.toBe("minimized");
});

test("hands the background continuation this pane's session", async () => {
  const mux = rex({ env: { REX_BLOCK: parked }, cwd: process.cwd(), run: spawnRunner });
  expect(await mux.handoffEnv?.()).toEqual({ REX_SESSION: session });
});
