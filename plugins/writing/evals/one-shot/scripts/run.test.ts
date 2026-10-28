import { describe, expect, test } from "bun:test";
import type { Message, QueryFn } from "../../../../../packages/eval-judge/index";
import { type Draft, fill, rewriteDraft } from "./run";

const makeDraft = (overrides: Partial<Draft> = {}): Draft => ({
  id: "abc",
  split: "dev",
  message: false,
  text: "The cache — cold at first — warms up after the first request.\n",
  ...overrides,
});

// Answers the rewrite prompt with `rewrite` and the meaning prompt with a
// clean verdict, recording each prompt it saw.
function fakeQuery(rewrite: string, prompts: string[]): QueryFn {
  return ({ prompt }) => {
    prompts.push(prompt);
    const output = prompt.includes("<findings>") ? { rewrite } : { preserved: true, lost: [] };
    const messages: Message[] = [{ type: "result", subtype: "success", structured_output: output }];
    const it = messages[Symbol.iterator]();
    return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(it.next()) }) };
  };
}

describe("rewriteDraft", () => {
  test("hands every finding to the model and rescans its rewrite", async () => {
    const prompts: string[] = [];
    const result = await rewriteDraft(makeDraft(), {
      model: "m",
      judgeModel: "j",
      query: fakeQuery("The cache starts cold and warms up after the first request.\n", prompts),
    });
    expect(prompts[0]).toContain("line 1, Writing.SpacedEmDash:");
    expect(result.before.map((f) => f.Check)).toContain("Writing.SpacedEmDash");
    expect(result.after).toEqual([]);
    expect(result.meaning).toEqual({ preserved: true, lost: [] });
    expect(result.words.after).toBe(11);
  });

  test("applies the message rules to a message draft", async () => {
    const prompts: string[] = [];
    const result = await rewriteDraft(
      makeDraft({ message: true, text: "Hi team,\n\nThe parser now streams input.\n" }),
      { model: "m", judgeModel: "j", query: fakeQuery("The parser now streams input.\n", prompts) },
    );
    expect(result.before.map((f) => f.Check)).toContain("Writing.Salutation");
  });
});

test("fill leaves unknown placeholders in place", () => {
  expect(fill("{{a}} and {{b}}", { a: "x" })).toBe("x and {{b}}");
});
