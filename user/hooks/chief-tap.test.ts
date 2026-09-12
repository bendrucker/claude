import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tap } from "./chief-tap";

let dir: string;
let SPOOL_PATH: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "chief-tap-"));
  SPOOL_PATH = join(dir, "chief-tap.test.jsonl");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(SPOOL_PATH, { force: true });
});

test("tap posts the body to the ingest url", async () => {
  const requests: { body: string; contentType: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      requests.push({ body: await req.text(), contentType: req.headers.get("content-type") });
      return new Response("ok");
    },
  });

  try {
    await tap('{"hook_event_name":"Stop"}', `http://127.0.0.1:${server.port}/ingest`);
  } finally {
    await server.stop(true);
  }

  expect(requests).toEqual([
    { body: '{"hook_event_name":"Stop"}', contentType: "application/json" },
  ]);
});

test("tap spools the body when the endpoint is unreachable", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const url = `http://127.0.0.1:${server.port}/ingest`;
  await server.stop(true);

  await tap('{"hook_event_name":"Stop"}', url, SPOOL_PATH);
  expect(await Bun.file(SPOOL_PATH).text()).toBe('{"hook_event_name":"Stop"}\n');
});
