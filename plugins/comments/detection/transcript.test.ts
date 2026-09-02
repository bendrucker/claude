import { describe, expect, test } from "bun:test";
import { editedPaths } from "./transcript";

const toolUse = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({ message: { content: [{ type: "tool_use", name, input }] } });

describe("editedPaths", () => {
  test("collects Edit/Write/MultiEdit paths once each, ignoring other records", () => {
    const transcript = [
      toolUse("Write", { file_path: "/repo/a.ts", content: "const x = 1;" }),
      toolUse("Edit", { file_path: "/repo/a.ts", old_string: "x", new_string: "y" }),
      toolUse("MultiEdit", { file_path: "/repo/b.py", edits: [] }),
      toolUse("Read", { file_path: "/repo/c.ts" }),
      toolUse("Write", { content: "no path" }),
      JSON.stringify({ type: "user", message: { content: "not an edit" } }),
      'not json but mentions "tool_use"',
    ].join("\n");

    expect(editedPaths(transcript)).toEqual(["/repo/a.ts", "/repo/b.py"]);
  });

  test("returns nothing for a transcript with no edits", () => {
    expect(editedPaths("")).toEqual([]);
  });
});
