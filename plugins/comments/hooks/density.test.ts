import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "density.ts");

const comment = (i: number) =>
  `// Explains step ${i} of the procedure in far more prose than the line below needs to justify.`;
const heavyContent = Array.from(
  { length: 32 },
  (_, i) => `${comment(i)}\nconst step${i} = ${i};`,
).join("\n");

const heavyTranscript = () =>
  `${JSON.stringify({
    message: {
      content: [
        { type: "tool_use", name: "Write", input: { file_path: "/repo/heavy.ts", content: heavyContent } },
      ],
    },
  })}\n`;

async function runHook(input: Record<string, unknown>): Promise<string> {
  const proc = Bun.spawn(["bun", HOOK], { stdin: "pipe", stdout: "pipe" });
  proc.stdin.write(JSON.stringify(input));
  await proc.stdin.end();
  const out = await proc.stdout.text();
  expect(await proc.exited).toBe(0);
  return out;
}

async function writeTranscript(content: string): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "density-hook-")), "session.jsonl");
  await Bun.write(path, content);
  return path;
}

describe("density Stop hook", () => {
  test("blocks a strong-tier session with a marked reason", async () => {
    const path = await writeTranscript(heavyTranscript());
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    const decision = JSON.parse(out) as { decision: string; reason: string };
    expect(decision.decision).toBe("block");
    expect(decision.reason).toStartWith("comment-density:");
    expect(decision.reason).toContain("heavy.ts");
  });

  test("stays silent when stop_hook_active", async () => {
    const path = await writeTranscript(heavyTranscript());
    const out = await runHook({
      hook_event_name: "Stop",
      transcript_path: path,
      stop_hook_active: true,
    });
    expect(out).toBe("");
  });

  test("stays silent when the transcript tail carries a prior block marker", async () => {
    const marker = `${JSON.stringify({ type: "user", message: { content: "comment-density: prior block" } })}\n`;
    const path = await writeTranscript(heavyTranscript() + marker);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(out).toBe("");
  });

  test("stays silent on a clean session", async () => {
    const path = await writeTranscript(
      `${JSON.stringify({
        message: {
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/repo/clean.ts", content: "const x = 1;" },
            },
          ],
        },
      })}\n`,
    );
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(out).toBe("");
  });
});
