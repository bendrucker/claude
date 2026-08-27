import { describe, expect, test } from "bun:test";
import { CorrectionRow, CorrectiveRow, DeliverableRow } from "./dump";

const corrective = {
  session_id: "s1",
  project: null,
  timestamp: new Date("2026-05-20T10:01:00Z"),
  user_chars: 12,
  user_text: "too flowery",
  user_source_file: null,
  user_source_line: null,
  matched_term: "fluff",
  context_chars: null,
  context_snippet: null,
};

describe("row decoding", () => {
  test("renders a Date column as ISO text", () => {
    expect(CorrectiveRow.parse(corrective).timestamp).toBe("2026-05-20T10:01:00.000Z");
  });

  test("keeps a timestamp that already arrived as text", () => {
    const parsed = CorrectionRow.parse({
      session_id: "s1",
      project: null,
      assistant_timestamp: "2026-05-20T10:00:00Z",
      user_timestamp: new Date("2026-05-20T10:01:00Z"),
      assistant_chars: 40,
      user_chars: 12,
      assistant_snippet: "a",
      user_snippet: "b",
      prose_signal: true,
    });
    expect(parsed.assistant_timestamp).toBe("2026-05-20T10:00:00Z");
    expect(parsed.user_timestamp).toBe("2026-05-20T10:01:00.000Z");
  });

  test("rejects a row missing a nullable column", () => {
    expect(() =>
      DeliverableRow.parse({ session_id: "s1", source_file: null, source_line: null, text: "x" }),
    ).toThrow("file_path");
  });
});
