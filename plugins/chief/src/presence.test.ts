import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { read } from "./presence";

const PATH = join(import.meta.dirname, "__fixtures__", "presence.test.json");

afterEach(async () => {
  await rm(PATH, { force: true });
});

test("read returns the stub presence and persists it", async () => {
  const presence = await read(PATH);
  expect(presence).toMatchObject({ focus: null, busyUntil: null, activeNode: "studio" });
  expect(JSON.parse(await Bun.file(PATH).text())).toEqual(presence);
});
