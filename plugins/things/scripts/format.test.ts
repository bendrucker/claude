import { describe, expect, mock, test } from "bun:test";
import { selectColumns } from "./format";

describe("selectColumns", () => {
  const headers = ["Name", "Status", "Due Date", "Project"];
  const rows = [
    ["Task 1", "open", "2025-01-01", "Project A"],
    ["Task 2", "completed", "2025-02-01", "Project B"],
  ];

  test("returns input unchanged when columns is undefined", () => {
    const [h, r] = selectColumns(headers, rows, undefined);
    expect(h).toEqual(headers);
    expect(r).toEqual(rows);
  });

  test("returns input unchanged when columns is empty", () => {
    const [h, r] = selectColumns(headers, rows, []);
    expect(h).toEqual(headers);
    expect(r).toEqual(rows);
  });

  test("filters to selected columns", () => {
    const [h, r] = selectColumns(headers, rows, ["name", "project"]);
    expect(h).toEqual(["Name", "Project"]);
    expect(r).toEqual([
      ["Task 1", "Project A"],
      ["Task 2", "Project B"],
    ]);
  });

  test("preserves column order from the columns argument", () => {
    const [h, r] = selectColumns(headers, rows, ["project", "name"]);
    expect(h).toEqual(["Project", "Name"]);
    expect(r).toEqual([
      ["Project A", "Task 1"],
      ["Project B", "Task 2"],
    ]);
  });

  test("normalizes column names with hyphens and case", () => {
    const [h] = selectColumns(headers, rows, ["due-date"]);
    expect(h).toEqual(["Due Date"]);
  });

  test("exits with error for unknown column", () => {
    const mockExit = mock(() => {
      throw new Error("process.exit");
    });
    const originalExit = process.exit;
    process.exit = mockExit as never;

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
