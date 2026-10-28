import { describe, expect, test } from "bun:test";
import { findAll } from "./findings";

const categories = (findings: { category: string }[]) => findings.map((f) => f.category);

describe("findAll", () => {
  const body =
    "The parser now streams input.\n\nWant me to add tests? Let me know if you'd like changes.\n";

  test("message rules appear only with message: true", async () => {
    const file = categories(await findAll(body, { filePath: "notes.md" }));
    const message = categories(await findAll(body, { message: true }));
    expect(message.length).toBeGreaterThan(file.length);
    const extra = message.filter((c) => !file.includes(c));
    expect(extra.length).toBeGreaterThan(0);
  });

  test("reports heading findings with line and column", async () => {
    const text = "Intro paragraph.\n\n## Every Finding Is Reported in One Batch\n\nBody.\n";
    const found = (await findAll(text, { filePath: "doc.md" })).filter(
      (f) => f.category === "sentence heading",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 3, col: 1, tier: "context", structural: false });
  });

  test("reports every heading of the same category", async () => {
    const text = "## the first part\n\ntext\n\n## the second part\n";
    const found = (await findAll(text, { filePath: "doc.md" })).filter(
      (f) => f.category === "title case heading",
    );
    expect(found.map((f) => f.line)).toEqual([1, 5]);
  });

  test("locates a repeated heading at each occurrence, past a prose mention", async () => {
    const text = "Read the first part below.\n\n## the first part\n\ntext\n\n## the first part\n";
    const found = (await findAll(text, { filePath: "doc.md" })).filter(
      (f) => f.category === "title case heading",
    );
    expect(found.map((f) => f.line)).toEqual([3, 7]);
  });

  test("reports bold-as-heading and step numbering with positions", async () => {
    const text = "Intro.\n\n**Setup:** do it.\n\n## Step 1\n";
    const found = await findAll(text, { filePath: "doc.md" });
    expect(found.find((f) => f.category === "bold as heading")).toMatchObject({ line: 3, col: 1 });
    expect(found.find((f) => f.category === "numbering")).toMatchObject({ line: 5, col: 1 });
  });

  test("skips heading checks for non-markdown files", async () => {
    const found = await findAll("// ## Step 1\n", { filePath: "main.ts" });
    expect(categories(found)).not.toContain("numbering");
  });

  test("sorts by line then column", async () => {
    const text = "## the first part\n\n**Setup:** go.\n\n## Step 1\n";
    const found = await findAll(text, { filePath: "doc.md", batch: true });
    const sorted = found.toSorted((a, b) => (a.line === b.line ? a.col - b.col : a.line - b.line));
    expect(found).toEqual(sorted);
    expect(found.length).toBeGreaterThan(2);
  });
});
