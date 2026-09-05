import { expect, test } from "bun:test";
import { join } from "node:path";
import { decodeFile } from "../../../packages/decode/index";
import {
  destination,
  ExportPayload,
  exportFilename,
  runCost,
  runDate,
  safeId,
  slug,
  suiteName,
} from "../results";

const described = await decodeFile(
  ExportPayload,
  join(import.meta.dirname, "exports", "described.json"),
);
const undated = await decodeFile(
  ExportPayload,
  join(import.meta.dirname, "exports", "undated.json"),
);
const metadataOnly: ExportPayload = {
  evalId: "eval-mdo-2026-07-04T10:00:00",
  metadata: { evaluationCreatedAt: "2026-07-04T10:00:00.000Z" },
};

test.each<{ name: string; payload: ExportPayload; override?: string; expected: string }>([
  { name: "reads the run timestamp", payload: described, expected: "2026-08-27" },
  { name: "falls back to the export metadata", payload: metadataOnly, expected: "2026-07-04" },
  { name: "takes an override", payload: described, override: "2026-01-05", expected: "2026-01-05" },
  {
    name: "dates a timestampless run",
    payload: undated,
    override: "2026-08-26",
    expected: "2026-08-26",
  },
])("runDate $name", ({ payload, override, expected }) => {
  expect(runDate(payload, override)).toBe(expected);
});

test.each<{ name: string; payload: ExportPayload; override?: string; message: RegExp }>([
  { name: "no timestamp and no override", payload: undated, message: /no run timestamp/ },
  { name: "malformed override", payload: described, override: "2026-1-5", message: /YYYY-MM-DD/ },
])("runDate rejects $name", ({ payload, override, message }) => {
  expect(() => runDate(payload, override)).toThrow(message);
});

test.each<{ input: string; expected: string }>([
  { input: "PR body A/B", expected: "pr-body-a-b" },
  { input: "Writing: voice & tone!", expected: "writing-voice-tone" },
  { input: "  pr-body  ", expected: "pr-body" },
  { input: "!!!", expected: "" },
])("slug($input)", ({ input, expected }) => {
  expect(slug(input)).toBe(expected);
});

test("suiteName derives from the config description", () => {
  expect(suiteName(described)).toBe("pr-body-a-b");
});

test("suiteName prefers an override", () => {
  expect(suiteName(described, "pr-body")).toBe("pr-body");
});

test("suiteName rejects a payload with nothing to name it", () => {
  expect(() => suiteName(undated)).toThrow(/pass --suite/);
});

test.each<{ input: string; expected: string }>([
  { input: "eval-abc-2026-08-01T12:00:00", expected: "eval-abc-2026-08-01T12-00-00" },
  { input: "eval/../x", expected: "eval-..-x" },
])("safeId($input)", ({ input, expected }) => {
  expect(safeId(input)).toBe(expected);
});

test("safeId rejects an id with no usable characters", () => {
  expect(() => safeId("///")).toThrow(/filename/);
});

test("exportFilename joins the run date and the sanitized id", () => {
  expect(exportFilename(described, "2026-08-27")).toBe(
    "2026-08-27-eval-xyz-2026-08-27T14-05-00.json",
  );
});

test("destination files an export under its suite", () => {
  expect(destination("/corpus", described, { suite: "pr-body" })).toBe(
    "/corpus/pr-body/2026-08-27-eval-xyz-2026-08-27T14-05-00.json",
  );
});

test.each<{ name: string; payload: ExportPayload; expected: number }>([
  { name: "sums the arm costs", payload: described, expected: 0.33 },
  { name: "is zero without prompts", payload: undated, expected: 0 },
])("runCost $name", ({ payload, expected }) => {
  expect(runCost(payload)).toBeCloseTo(expected, 5);
});
