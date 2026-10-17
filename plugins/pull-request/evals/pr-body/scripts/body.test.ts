import { expect, test } from "bun:test";
import { type Body, bodyOf } from "./body";

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n");

const toolResult = (content: unknown) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "t", content }] },
});

const replyTrace = (reply: string) => jsonl([{ type: "result", result: reply }]);

test.each<{ name: string; trace: string; body: string | undefined; source?: Body["source"] }>([
  {
    name: "array tool_result content",
    trace: jsonl([toolResult([{ type: "text", text: "PR-BODY-BEGIN\nHello\nPR-BODY-END\n" }])]),
    body: "Hello",
    source: "stub",
  },
  {
    name: "string tool_result content",
    trace: jsonl([toolResult("noise\nPR-BODY-BEGIN\nHello\nPR-BODY-END")]),
    body: "Hello",
    source: "stub",
  },
  {
    name: "last stub block wins",
    trace: jsonl([
      toolResult("PR-BODY-BEGIN\nfirst\nPR-BODY-END"),
      toolResult("PR-BODY-BEGIN\nsecond\nPR-BODY-END"),
    ]),
    body: "second",
    source: "stub",
  },
  {
    name: "stub beats the reply",
    trace: jsonl([
      toolResult("PR-BODY-BEGIN\nstub\nPR-BODY-END"),
      { type: "result", result: "Title: T\n\nreply" },
    ]),
    body: "stub",
    source: "stub",
  },
  {
    name: "reply after its Title line",
    trace: replyTrace("Push failed.\n\nTitle: T\n\nreply"),
    body: "reply",
    source: "reply",
  },
  { name: "reply without a Title line", trace: replyTrace("Just prose."), body: undefined },
])("bodyOf: $name", ({ trace, body, source }) => {
  expect(bodyOf(trace)?.text).toBe(body);
  expect(bodyOf(trace)?.source).toEqual(source);
});
