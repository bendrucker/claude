import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscript } from ".";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "stop-hook-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createTranscriptContent(files: Array<{ path: string; tool: string }>): string {
  return files
    .map((f) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: f.tool,
              input: { file_path: f.path },
            },
          ],
        },
      }),
    )
    .join("\n");
}

describe("parseTranscript", () => {
  it("returns empty array for non-existent transcript", async () => {
    expect(await parseTranscript("/nonexistent/path.jsonl")).toEqual([]);
  });

  it("extracts file paths from Edit and Write tool uses", async () => {
    const filePath = join(tempDir, "test.ts");
    const mdPath = join(tempDir, "readme.md");
    await writeFile(filePath, "export {}");
    await writeFile(mdPath, "# Test");

    const transcriptPath = join(tempDir, "transcript-tools.jsonl");
    await writeFile(
      transcriptPath,
      createTranscriptContent([
        { path: filePath, tool: "Edit" },
        { path: mdPath, tool: "Write" },
      ]),
    );

    const files = await parseTranscript(transcriptPath);
    expect(files).toContain(filePath);
    expect(files).toContain(mdPath);
  });

  it("ignores non-Edit/Write tools", async () => {
    const filePath = join(tempDir, "read-only.ts");
    await writeFile(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-read.jsonl");
    await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Read" }]));

    expect(await parseTranscript(transcriptPath)).toEqual([]);
  });

  it("deduplicates file paths", async () => {
    const filePath = join(tempDir, "dup.ts");
    await writeFile(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-dup.jsonl");
    await writeFile(
      transcriptPath,
      createTranscriptContent([
        { path: filePath, tool: "Edit" },
        { path: filePath, tool: "Write" },
      ]),
    );

    expect(await parseTranscript(transcriptPath)).toHaveLength(1);
  });

  it("filters out deleted files", async () => {
    const transcriptPath = join(tempDir, "transcript-deleted.jsonl");
    await writeFile(
      transcriptPath,
      createTranscriptContent([{ path: "/nonexistent/deleted.ts", tool: "Write" }]),
    );

    expect(await parseTranscript(transcriptPath)).toEqual([]);
  });
});
