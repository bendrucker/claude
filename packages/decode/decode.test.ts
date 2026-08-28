import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DecodeError, decode, decodeJson, decodeJsonLines } from "./index";
import { decodeFile, decodeFileLines, decodeStdin } from "./sources";

const Review = z.object({
  number: z.number(),
  title: z.string(),
  author: z.object({ login: z.string() }),
});

const Tag = z.object({ name: z.string() });

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "decode-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function thrown(run: () => void): DecodeError {
  try {
    run();
  } catch (error) {
    if (error instanceof DecodeError) return error;
    throw error;
  }
  throw new Error("expected a DecodeError");
}

function message(run: () => void): string {
  return thrown(run).message;
}

describe("failure messages", () => {
  test.each<{ title: string; text: string; schema?: z.ZodType }>([
    { title: "malformed JSON names the source and echoes the input", text: '{"number":' },
    { title: "empty input", text: "" },
    { title: "whitespace-only input", text: "   \n  " },
    { title: "JSON null against an object schema", text: "null" },
    { title: "wrong type at the root", text: '"a string"' },
    { title: "missing and mistyped fields report every issue", text: '{"number":"12"}' },
    {
      title: "a nested path is spelled out",
      text: '{"number":12,"title":"t","author":{"login":7}}',
    },
    {
      title: "array index appears in the path",
      text: '[{"name":"ok"},{"name":3}]',
      schema: z.array(Tag),
    },
    {
      title: "an oversized payload is truncated in the echo",
      text: `{"number":${"9".repeat(400)}`,
    },
  ])("$title", ({ text, schema = Review }) => {
    expect(message(() => decodeJson(schema, text, "gh pr view output"))).toMatchSnapshot();
  });
});

describe("decodeJson", () => {
  test("returns the parsed value typed by the schema", () => {
    const pr = decodeJson(Review, '{"number":12,"title":"t","author":{"login":"ben"}}', "gh");
    expect(pr).toEqual({ number: 12, title: "t", author: { login: "ben" } });
  });

  test("strips unknown keys under a strict object and keeps them under a loose one", () => {
    const text = '{"name":"a","extra":1}';
    expect(decodeJson(Tag, text, "src")).toEqual({ name: "a" });
    expect(decodeJson(z.looseObject({ name: z.string() }), text, "src")).toEqual({
      name: "a",
      extra: 1,
    });
  });

  test("applies schema defaults and transforms", () => {
    const schema = z.object({ retries: z.number().default(3), name: z.string().trim() });
    expect(decodeJson(schema, '{"name":"  a  "}', "src")).toEqual({ retries: 3, name: "a" });
  });
});

describe("decode", () => {
  test("validates an already-parsed value", () => {
    expect(decode(Tag, { name: "a" }, "Bun.file().json()")).toEqual({ name: "a" });
  });

  test("reports a syntax-free failure without an input echo", () => {
    expect(message(() => decode(Tag, { name: 1 }, "catalog entry"))).toMatchSnapshot();
  });
});

describe("decodeJsonLines", () => {
  test("decodes every record and skips blank lines", () => {
    const text = '{"name":"a"}\n\n{"name":"b"}\n';
    expect(decodeJsonLines(Tag, text, "transcript")).toEqual([{ name: "a" }, { name: "b" }]);
  });

  test("returns an empty array for empty input", () => {
    expect(decodeJsonLines(Tag, "\n  \n", "transcript")).toEqual([]);
  });

  test.each([
    { title: "a bad record reports its 1-based line number", text: '{"name":"a"}\n{"name":3}' },
    {
      title: "blank lines do not shift the reported line number",
      text: '{"name":"a"}\n\n\n{"name":3}',
    },
  ])("$title", ({ text }) => {
    expect(message(() => decodeJsonLines(Tag, text, "transcript"))).toMatchSnapshot();
  });
});

describe("DecodeError", () => {
  test("carries the source and the zod issues", () => {
    const error = thrown(() => decodeJson(Review, '{"number":"12"}', "gh pr view output"));
    expect(error.source).toBe("gh pr view output");
    expect(error.issues.map((issue) => issue.path.join("."))).toEqual([
      "number",
      "title",
      "author",
    ]);
  });

  test("a syntax failure carries no issues", () => {
    expect(thrown(() => decodeJson(Review, "{", "gh pr view output")).issues).toEqual([]);
  });
});

describe("roundtrip", () => {
  test("any value the schema accepts survives stringify then decode", () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().int(),
      active: z.boolean(),
      tags: z.array(z.string()),
      note: z.string().nullable(),
    });

    fc.assert(
      fc.property(
        fc.record({
          name: fc.string(),
          count: fc.integer(),
          active: fc.boolean(),
          tags: fc.array(fc.string()),
          note: fc.option(fc.string(), { nil: null }),
        }),
        (value) => {
          expect(decodeJson(schema, JSON.stringify(value), "roundtrip")).toEqual(value);
        },
      ),
    );
  });

  test("any record list survives stringify then line decode", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ name: fc.string() })), (records) => {
        const text = records.map((record) => JSON.stringify(record)).join("\n");
        expect(decodeJsonLines(Tag, text, "roundtrip")).toEqual(records);
      }),
    );
  });
});

describe("sources", () => {
  test("decodeFile names the path in its failure", async () => {
    const good = join(tempDir, "good.json");
    const bad = join(tempDir, "bad.json");
    await Bun.write(good, '{"name":"a"}');
    await Bun.write(bad, '{"name":1}');

    expect(await decodeFile(Tag, good)).toEqual({ name: "a" });
    expect(decodeFile(Tag, bad)).rejects.toThrow(`${bad} did not match its schema`);
  });

  test("decodeFileLines reads a JSONL file", async () => {
    const path = join(tempDir, "lines.jsonl");
    await Bun.write(path, '{"name":"a"}\n{"name":"b"}\n');
    expect(await decodeFileLines(Tag, path)).toEqual([{ name: "a" }, { name: "b" }]);
  });

  test("decodeStdin defaults its source label and accepts an override", () => {
    const stdin = spyOn(Bun.stdin, "text").mockResolvedValue('{"name":1}');
    try {
      expect(decodeStdin(Tag)).rejects.toThrow("stdin did not match its schema");
      expect(decodeStdin(Tag, "newline/check hook input")).rejects.toThrow(
        "newline/check hook input did not match its schema",
      );
    } finally {
      stdin.mockRestore();
    }
  });
});
