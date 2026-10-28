import { expect, test } from "bun:test";
import { changedLines, valeFileFindings } from "./vale-findings";

test.each<{ name: string; before: string; after: string; changed: number[] }>([
  { name: "new file", before: "", after: "a\nb", changed: [1, 2] },
  { name: "appended line", before: "a\nb", after: "a\nb\nc", changed: [3] },
  { name: "edited middle line", before: "a\nb\nc", after: "a\nB\nc", changed: [2] },
  { name: "duplicate line added", before: "a", after: "a\na", changed: [2] },
  { name: "unchanged", before: "a\nb", after: "a\nb", changed: [] },
])("changedLines: $name", ({ before, after, changed }) => {
  expect([...changedLines(before, after)]).toEqual(changed);
});

test.each<{ name: string; before: string; after: string; checks: string[] }>([
  {
    name: "a trope the edited line already had",
    before: "Title — kept.\n",
    after: "Title — kept, with more.\n",
    checks: [],
  },
  {
    name: "a second trope on the edited line",
    before: "Title — kept.\n",
    after: "Title — kept — again.\n",
    checks: ["Writing.SpacedEmDash", "ai-tells.EmDashUsage"],
  },
  {
    name: "each occurrence of a trope",
    before: "",
    after: "One — two — three.\n",
    checks: [
      "Writing.SpacedEmDash",
      "ai-tells.EmDashUsage",
      "Writing.SpacedEmDash",
      "ai-tells.EmDashUsage",
    ],
  },
  {
    name: "a trope on an untouched line",
    before: "Title — kept.\nPlain.\n",
    after: "Title — kept.\nPlain, longer.\n",
    checks: [],
  },
])("valeFileFindings reports $name", async ({ before, after, checks }) => {
  const findings = await valeFileFindings(before, after, "/nonexistent/doc.md");
  expect(findings.map((finding) => finding.check)).toEqual(checks);
});
