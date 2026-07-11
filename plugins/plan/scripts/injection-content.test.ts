import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(import.meta.dirname, "injection-content.sh");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "plan-inject-content-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function transcriptWith(models: string[]): Promise<string> {
  const lines = models.map((model) =>
    JSON.stringify({ type: "assistant", message: { role: "assistant", model, content: [] } }),
  );
  const path = join(dir, "transcript.jsonl");
  await Bun.write(path, `${lines.join("\n")}\n`);
  return path;
}

async function assemble(transcript: string | null): Promise<string> {
  const args = transcript === null ? [scriptPath] : [scriptPath, transcript];
  const proc = Bun.spawn(["bash", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

test.each<{ name: string; models: string[]; delegation: boolean }>([
  { name: "opus includes delegation", models: ["claude-opus-4-8"], delegation: true },
  { name: "fable includes delegation", models: ["claude-fable-5"], delegation: true },
  { name: "sonnet excludes delegation", models: ["claude-sonnet-5"], delegation: false },
  { name: "haiku excludes delegation", models: ["claude-haiku-4-5-20251001"], delegation: false },
  {
    name: "last assistant model wins (ends sonnet)",
    models: ["claude-opus-4-8", "claude-sonnet-5"],
    delegation: false,
  },
  {
    name: "last assistant model wins (ends opus)",
    models: ["claude-sonnet-5", "claude-opus-4-8"],
    delegation: true,
  },
])("$name", async ({ models, delegation }) => {
  const out = await assemble(await transcriptWith(models));
  expect(out).toContain("Planning Guidelines");
  expect(out.includes("# Delegation")).toBe(delegation);
});

describe("fail open", () => {
  test("guidelines only when no transcript is given", async () => {
    const out = await assemble(null);
    expect(out).toContain("Planning Guidelines");
    expect(out).not.toContain("# Delegation");
  });

  test("guidelines only when the transcript path is missing", async () => {
    const out = await assemble(join(dir, "does-not-exist.jsonl"));
    expect(out).toContain("Planning Guidelines");
    expect(out).not.toContain("# Delegation");
  });

  test("guidelines only when the transcript is malformed", async () => {
    const path = join(dir, "bad.jsonl");
    await Bun.write(path, "not json\n{also not\n");
    const out = await assemble(path);
    expect(out).toContain("Planning Guidelines");
    expect(out).not.toContain("# Delegation");
  });
});
