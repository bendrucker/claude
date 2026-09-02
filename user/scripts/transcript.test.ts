import { expect, test } from "bun:test";
import { join } from "node:path";
import { readTranscriptTail } from "./transcript";

const TMP_DIR = process.env.TMPDIR ?? "/tmp";

async function write(lines: string[]): Promise<string> {
  const path = join(TMP_DIR, `transcript-${crypto.randomUUID()}.jsonl`);
  await Bun.write(path, lines.map((line) => `${line}\n`).join(""));
  return path;
}

test("parses every well-formed line", async () => {
  const path = await write(['{"n":1}', '{"n":2}']);
  expect(await readTranscriptTail(path, 1024)).toEqual([{ n: 1 }, { n: 2 }]);
});

test("skips malformed lines", async () => {
  const path = await write(['{"n":1}', "not json", '{"n":2}']);
  expect(await readTranscriptTail(path, 1024)).toEqual([{ n: 1 }, { n: 2 }]);
});

test("drops the partial line a mid-file slice splits", async () => {
  const path = await write([`{"pad":"${"x".repeat(200)}"}`, '{"n":2}']);
  expect(await readTranscriptTail(path, 64)).toEqual([{ n: 2 }]);
});

test("returns nothing for an empty file", async () => {
  expect(await readTranscriptTail(await write([]), 1024)).toEqual([]);
});

test("returns nothing for a missing file", async () => {
  expect(await readTranscriptTail(join(TMP_DIR, "absent.jsonl"), 1024)).toEqual([]);
});
