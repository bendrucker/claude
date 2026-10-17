import { describe, expect, test } from "bun:test";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  blind,
  cacheKey,
  deblind,
  isFresh,
  jsonSchema,
  judgeBlind,
  type Message,
  type Pick,
  promptHash,
  type QueryFn,
  type Side,
  type Slot,
  structured,
  subscriptionEnv,
} from "./index";

describe("blind / deblind", () => {
  test.each<{ flip: boolean; left: Side }>([
    { flip: false, left: "a" },
    { flip: true, left: "b" },
  ])("blind($flip) puts $left on the left", ({ flip, left }) => {
    expect(blind(flip)).toBe(left);
  });

  test.each<{ slot: Slot; left: Side; expected: Pick }>([
    { slot: "1", left: "a", expected: "a" },
    { slot: "2", left: "a", expected: "b" },
    { slot: "1", left: "b", expected: "b" },
    { slot: "2", left: "b", expected: "a" },
    { slot: "tie", left: "a", expected: "tie" },
  ])("deblind($slot, $left) -> $expected", ({ slot, left, expected }) => {
    expect(deblind(slot, left)).toBe(expected);
  });
});

describe("judgeBlind", () => {
  test("de-blinds a single verdict and calls once without swap", async () => {
    const lefts: Side[] = [];
    const result = await judgeBlind(
      (left) => {
        lefts.push(left);
        return Promise.resolve({ pick: "2", reason: "right wins" });
      },
      { swap: false, rng: () => 1 },
    );
    expect(lefts).toEqual(["a"]);
    expect(result).toEqual({ pick: "b", left: "a", reason: "right wins" });
  });

  test("swap renders the other side on the left and keeps an agreeing pick", async () => {
    const lefts: Side[] = [];
    const result = await judgeBlind(
      (left) => {
        lefts.push(left);
        return Promise.resolve({ pick: left === "a" ? "2" : "1", reason: `left ${left}` });
      },
      { swap: true, rng: () => 0 },
    );
    expect(lefts).toEqual(["b", "a"]);
    expect(result).toEqual({ pick: "b", left: "b", reason: "left b" });
  });

  test("swap disagreement forces a tie", async () => {
    const result = await judgeBlind(() => Promise.resolve({ pick: "1", reason: "first" }), {
      swap: true,
      rng: () => 1,
    });
    expect(result.pick).toBe("tie");
    expect(result.reason).toBe("swap disagreement (a then b): first / first");
  });
});

describe("cacheKey / isFresh", () => {
  test("keys on every part and its position", () => {
    const key = cacheKey("h", "m", false, "brief", "A", "B");
    expect(key).toHaveLength(16);
    expect(cacheKey("h", "m", false, "brief", "A", "B")).toBe(key);
    expect(cacheKey("h", "m", true, "brief", "A", "B")).not.toBe(key);
    expect(cacheKey("h", "m", false, "brief", "B", "A")).not.toBe(key);
  });

  test.each<{ name: string; existing: { key?: string } | undefined; expected: boolean }>([
    { name: "nothing cached", existing: undefined, expected: false },
    { name: "same key", existing: { key: "k" }, expected: true },
    { name: "no recorded key", existing: {}, expected: false },
    { name: "other key", existing: { key: "j" }, expected: false },
  ])("$name -> $expected", ({ existing, expected }) => {
    expect(isFresh(existing, "k")).toBe(expected);
  });

  test("promptHash is a 12-character hex prefix", () => {
    expect(promptHash("template")).toMatch(/^[0-9a-f]{12}$/);
    expect(promptHash("template")).not.toBe(promptHash("template 2"));
  });
});

describe("subscriptionEnv", () => {
  test("drops API credentials and keeps the rest", () => {
    expect(
      subscriptionEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", HOME: "/h" }),
    ).toEqual({ HOME: "/h" });
  });
});

describe("jsonSchema", () => {
  test("renders a closed object without the $schema key", () => {
    expect(jsonSchema(z.object({ pick: z.enum(["1", "2", "tie"]) }))).toEqual({
      type: "object",
      properties: { pick: { type: "string", enum: ["1", "2", "tie"] } },
      required: ["pick"],
      additionalProperties: false,
    });
  });
});

describe("structured", () => {
  const Reply = z.object({ pick: z.enum(["1", "2", "tie"]) });
  const stream = (items: Message[]): AsyncIterable<Message> => {
    const it = items[Symbol.iterator]();
    return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(it.next()) }) };
  };
  const fake = (...messages: Message[]): { query: QueryFn; calls: Options[] } => {
    const calls: Options[] = [];
    return {
      calls,
      query({ options }) {
        calls.push(options);
        return stream(messages);
      },
    };
  };

  test("decodes structured output and sends a tool-less subscription call", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "secret";
    try {
      const { query, calls } = fake(
        { type: "assistant" },
        { type: "result", subtype: "success", structured_output: { pick: "2" } },
      );
      expect(await structured(Reply, "p", { model: "m", label: "reply", query })).toEqual({
        pick: "2",
      });
      expect(calls[0]?.model).toBe("m");
      expect(calls[0]?.tools).toEqual([]);
      expect(calls[0]?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(calls[0]?.outputFormat).toEqual({ type: "json_schema", schema: jsonSchema(Reply) });
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  test("falls back to the result text", async () => {
    const { query } = fake({ type: "result", subtype: "success", result: '{"pick":"tie"}' });
    expect(await structured(Reply, "p", { model: "m", label: "reply", query })).toEqual({
      pick: "tie",
    });
  });

  test.each<{ name: string; messages: Message[]; message: string }>([
    {
      name: "an error result",
      messages: [{ type: "result", subtype: "error_max_turns" }],
      message: "reply call failed: error_max_turns",
    },
    { name: "no result", messages: [], message: "reply call produced no result message" },
    {
      name: "a reply off the schema",
      messages: [{ type: "result", subtype: "success", structured_output: { pick: "3" } }],
      message: "reply",
    },
  ])("rejects $name", ({ messages, message }) => {
    const { query } = fake(...messages);
    expect(structured(Reply, "p", { model: "m", label: "reply", query })).rejects.toThrow(message);
  });
});
