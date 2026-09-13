import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read } from "./presence";

let dir: string;
let PATH: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "chief-presence-"));
  PATH = join(dir, "presence.test.json");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(PATH, { force: true });
});

test("read returns the stub presence and persists it", async () => {
  const presence = await read(PATH);
  expect(presence).toMatchObject({ focus: null, busyUntil: null, activeNode: "studio" });
  expect(JSON.parse(await Bun.file(PATH).text())).toEqual(presence);
});
