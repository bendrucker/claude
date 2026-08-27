import { describe, expect, mock, test } from "bun:test";
import { selectColumns, stringify } from "./format";

describe("stringify", () => {
  test.each<[unknown, string]>([
    ["Ship it", "Ship it"],
    [3, "3"],
    [true, "true"],
    [{ name: "Inbox" }, '{"name":"Inbox"}'],
    [["a", "b"], '["a","b"]'],
  ])("%o -> %s", (value, expected) => {
    expect(stringify(value)).toBe(expected);
  });
});

describe("selectColumns", () => {
  const headers = ["Name", "Status", "Due Date", "Project"];
  const rows = [
    ["Task 1", "open", "2025-01-01", "Project A"],
    ["Task 2", "completed", "2025-02-01", "Project B"],
  ];

  test("fills a cell a short row does not reach", () => {
    const [, r] = selectColumns(headers, [["Task 1", "open"]], ["name", "project"]);
    expect(r).toEqual([["Task 1", ""]]);
  });

  test.each<[string, string[] | undefined, string[], string[][] | undefined]>([
    ["returns input unchanged when columns is undefined", undefined, headers, rows],
    ["returns input unchanged when columns is empty", [], headers, rows],
    [
      "filters to selected columns",
      ["name", "project"],
      ["Name", "Project"],
      [
        ["Task 1", "Project A"],
        ["Task 2", "Project B"],
      ],
    ],
    [
      "preserves column order from the columns argument",
      ["project", "name"],
      ["Project", "Name"],
      [
        ["Project A", "Task 1"],
        ["Project B", "Task 2"],
      ],
    ],
    ["normalizes column names with hyphens and case", ["due-date"], ["Due Date"], undefined],
  ])("%s", (_name, columns, expectedHeaders, expectedRows) => {
    const [h, r] = selectColumns(headers, rows, columns);
    expect(h).toEqual(expectedHeaders);
    if (expectedRows) expect(r).toEqual(expectedRows);
  });

  test("exits with error for unknown column", () => {
    const mockExit = mock(() => {
      throw new Error("process.exit");
    });
    const originalExit = process.exit;
    process.exit = mockExit;

    const mockError = mock();
    const originalError = console.error;
    console.error = mockError;

    try {
      selectColumns(headers, rows, ["unknown"]);
    } catch {
      // expected
    }

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      "Unknown column: unknown. Available: Name, Status, Due Date, Project",
    );

    process.exit = originalExit;
    console.error = originalError;
  });
});
