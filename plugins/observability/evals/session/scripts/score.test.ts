import { describe, expect, test } from "bun:test";
import { overlap, processOf } from "./score";

const keyed = {
  rows: [
    { key: "Bash", value: 25 },
    { key: "Edit", value: 4 },
  ],
  tolerance: 0,
};

describe("overlap", () => {
  test("matches a key and its value on one line", () => {
    const reply = "Hook denies since 2026-09-19:\n\n- Bash: 25\n- Edit: 4";
    expect(overlap(reply, keyed)).toEqual({ recall: 1, precision: 1 });
  });

  test("misses a value stated on another key's line", () => {
    const reply = "- Bash: 4\n- Edit: 25";
    expect(overlap(reply, keyed)).toEqual({ recall: 0, precision: 0 });
  });

  test("counts an extra answer line against precision", () => {
    const reply = "| tool | denies |\n|---|---|\n| Bash | 25 |\n| Edit | 4 |\n| Write | 1,203 |";
    expect(overlap(reply, keyed)).toEqual({ recall: 1, precision: 2 / 3 });
  });

  test("never reads a date as a count", () => {
    const truth = { rows: [{ value: 2026 }], tolerance: 0 };
    expect(overlap("Nothing since 2026-09-19.", truth).recall).toBe(0);
  });

  test("scores a scalar within its tolerance, with precision equal to recall", () => {
    const truth = { rows: [{ value: 1000 }], tolerance: 0.05 };
    expect(overlap("You interrupted Claude 1,040 times.", truth)).toEqual({
      recall: 1,
      precision: 1,
    });
    expect(overlap("You interrupted Claude 1,100 times.", truth).recall).toBe(0);
  });
});

const line = (value: unknown) => JSON.stringify(value);
const use = (id: string, input: Record<string, unknown>, name = "Bash") =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: string) =>
  line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });

describe("processOf", () => {
  const trace = [
    use("a", { file_path: "/x/resources/queries/hook-blocks.sql" }, "Read"),
    use("b", { command: `duckdb -readonly db "SELECT 1"` }),
    result("b", "Binder Error: column x not found"),
    use("c", { command: `duckdb -readonly db "SELECT 2"` }),
    result("c", "[{}]"),
    use("d", { command: "ls" }),
    result("d", "Parser Error: not a query"),
    line({
      type: "result",
      result: "done",
      duration_ms: 1500,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 },
    }),
  ].join("\n");

  test("counts duckdb queries and the SQL errors they returned, even on exit 0", () => {
    expect(processOf(trace)).toEqual({
      tokens: 115,
      seconds: 1.5,
      queries: 2,
      errors: 1,
      reference: true,
    });
  });

  test("checks the reference against reads and commands", () => {
    expect(processOf(trace, /hook-blocks\.sql/).reference).toBe(true);
    expect(processOf(trace, /plans\.sql/).reference).toBe(false);
  });
});
