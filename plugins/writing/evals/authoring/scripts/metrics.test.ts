import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  hookDenies,
  loadRuns,
  render,
  type Runs,
  tokenUsage,
  tropeDensity,
  WRITING_DENY_MARKERS,
} from "./metrics";

const line = (obj: object): string => JSON.stringify(obj);

const toolUseResult = (toolUseId: string, text: string, isError = true) => ({
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: isError, content: text }],
  },
});

const resultLine = (extra: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  result: "done",
  ...extra,
});

const trace = (...lines: object[]): string => lines.map(line).join("\n");

describe("tokenUsage", () => {
  test("prefers modelUsage, summed across models", () => {
    const usage = tokenUsage(
      trace(
        resultLine({
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          modelUsage: {
            "claude-opus-5-5": {
              inputTokens: 10,
              outputTokens: 20,
              cacheReadInputTokens: 5,
              cacheCreationInputTokens: 3,
            },
            "claude-haiku-5": { inputTokens: 1, outputTokens: 2 },
          },
        }),
      ),
    );
    expect(usage).toEqual({ total: 10 + 20 + 5 + 3 + 1 + 2, output: 22 });
  });

  test("falls back to usage when modelUsage is absent", () => {
    const usage = tokenUsage(
      trace(
        resultLine({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        }),
      ),
    );
    expect(usage).toEqual({ total: 165, output: 50 });
  });

  test("reads the last result line, since usage is cumulative", () => {
    const usage = tokenUsage(
      trace(
        resultLine({ usage: { input_tokens: 1, output_tokens: 1 } }),
        resultLine({ usage: { input_tokens: 9, output_tokens: 9 } }),
      ),
    );
    expect(usage).toEqual({ total: 18, output: 9 });
  });

  test("is undefined when neither field is present", () => {
    expect(tokenUsage(trace(resultLine()))).toBeUndefined();
  });
});

describe("hookDenies", () => {
  test.each([
    ["spaced em dash", "Spaced em dashes ( — ) are an AI writing tell. Split the clauses."],
    ["salutation", '"Dana," opens the comment with a salutation. Delete the address.'],
    [
      "numbering",
      "Detected step or phase numbering that creates tight coupling.\nUse descriptive names.",
    ],
  ])("counts a %s deny", (_name, text) => {
    expect(hookDenies(trace(toolUseResult("t1", text)))).toBe(1);
  });

  test("strips the harness's PreToolUse hook error prefix before matching", () => {
    const text = "PreToolUse:Bash hook error: Spaced em dashes ( — ) are an AI writing tell.";
    expect(hookDenies(trace(toolUseResult("t1", text)))).toBe(1);
  });

  test("reads an array-of-blocks tool_result content the same as a plain string", () => {
    const withBlocks = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: [{ type: "text", text: "Spaced em dashes ( — ) are an AI writing tell." }],
          },
        ],
      },
    };
    expect(hookDenies(trace(withBlocks))).toBe(1);
  });

  test("does not count a pull-request:validate-body deny", () => {
    const text = "Fix the PR body before retrying:\n- drop the AI vocabulary";
    expect(hookDenies(trace(toolUseResult("t1", text)))).toBe(0);
  });

  test("does not count a genuine tool failure, such as a stubbed network call", () => {
    const text = "Exit code 1: gh: authentication required";
    expect(hookDenies(trace(toolUseResult("t1", text)))).toBe(0);
  });

  test("does not count a non-error tool_result", () => {
    const text = WRITING_DENY_MARKERS[0] ?? "";
    expect(hookDenies(trace(toolUseResult("t1", text, false)))).toBe(0);
  });

  test("counts every matching block across a trace", () => {
    expect(
      hookDenies(
        trace(
          toolUseResult("t1", "Spaced em dashes ( — ) are an AI writing tell."),
          toolUseResult("t2", "unrelated failure"),
          toolUseResult("t3", "Detected step or phase numbering that creates tight coupling."),
        ),
      ),
    ).toBe(2);
  });
});

describe("tropeDensity", () => {
  test("is zero for clean prose and positive for flagged vocabulary", () => {
    expect(tropeDensity("Plain text with no flagged words at all here today.")).toBe(0);
    expect(tropeDensity("Let's delve into the details of this change.")).toBeGreaterThan(0);
  });

  test("is zero for empty text", () => {
    expect(tropeDensity("")).toBe(0);
  });
});

describe("loadRuns and render", () => {
  async function writeColumn(cases: Record<string, Record<string, string[]>>): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "metrics-"));
    const writes: Promise<number>[] = [];
    for (const [name, arms] of Object.entries(cases)) {
      for (const [arm, traces] of Object.entries(arms)) {
        for (const [i, text] of traces.entries()) {
          writes.push(Bun.write(join(dir, "traces", `${name}-${arm}-${i}.jsonl`), text));
        }
      }
    }
    await Promise.all(writes);
    return dir;
  }

  function traceWith(tokens: number, denyText: string | undefined, out: string): string {
    const lines: object[] = [];
    if (denyText !== undefined) lines.push(toolUseResult("t1", denyText));
    lines.push(
      resultLine({
        result: `<out>\n${out}\n</out>`,
        usage: { input_tokens: tokens, output_tokens: 0 },
      }),
    );
    return trace(...lines);
  }

  test("groups runs by case/arm and computes per-run metrics", async () => {
    const dir = await writeColumn({
      brief: {
        with: [
          traceWith(
            100,
            "Spaced em dashes ( — ) are an AI writing tell.",
            "Clean deliverable text.",
          ),
        ],
      },
    });
    const runs = await loadRuns([dir]);
    const cell = runs.get("brief/with");
    expect(cell).toHaveLength(1);
    expect(cell?.[0]).toEqual({ tokens: { total: 100, output: 0 }, denies: 1, density: 0 });
  });

  test("renders a table with a starred cost guard and a JSON report", async () => {
    const base = await writeColumn({
      brief: {
        with: [traceWith(100, undefined, "clean text"), traceWith(100, undefined, "clean text")],
      },
    });
    const candidate = await writeColumn({
      brief: {
        with: [traceWith(1000, undefined, "clean text"), traceWith(1000, undefined, "clean text")],
      },
    });
    const runs: Runs[] = await Promise.all([base, candidate].map((d) => loadRuns([d])));

    const text = render({ runs, labels: ["base", "candidate"], alpha: 0.1, guardMultiplier: 1.1 });
    expect(text).toContain("Cost guard");
    expect(text).toContain("fail");

    const json = render({
      runs,
      labels: ["base", "candidate"],
      alpha: 0.1,
      guardMultiplier: 1.1,
      json: true,
    });
    const Guard = z.object({
      guard: z.array(
        z.object({
          label: z.string(),
          baseMean: z.number(),
          mean: z.number(),
          limit: z.number(),
          pass: z.boolean(),
        }),
      ),
    });
    const parsed = Guard.parse(JSON.parse(json));
    expect(parsed.guard).toHaveLength(1);
    expect(parsed.guard[0]).toMatchObject({
      label: "candidate",
      baseMean: 100,
      mean: 1000,
      pass: false,
    });
    expect(parsed.guard[0]?.limit).toBeCloseTo(110);
  });
});
