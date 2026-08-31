import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const Decision = z.object({ decision: z.string(), reason: z.string() });

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
        {
          type: "tool_use",
          name: "Write",
          input: { file_path: "/repo/heavy.ts", content: heavyContent },
        },
      ],
    },
  })}\n`;

async function runHook(input: Record<string, unknown>): Promise<string> {
  const proc = Bun.spawn(["bun", HOOK], { stdin: "pipe", stdout: "pipe" });
  await proc.stdin.write(JSON.stringify(input));
  await proc.stdin.end();
  const out = await new Response(proc.stdout).text();
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
    const decision = Decision.parse(JSON.parse(out));
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

  test("stays silent when the tail carries relayed Stop-hook feedback", async () => {
    const marker = `${JSON.stringify({
      type: "user",
      message: { content: "Stop hook feedback:\n[density]: comment-density: prior block" },
    })}\n`;
    const path = await writeTranscript(heavyTranscript() + marker);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(out).toBe("");
  });

  test("still blocks when ordinary message text mentions the marker", async () => {
    const mention = `${JSON.stringify({
      type: "user",
      message: { content: "let's rename the comment-density: marker constant" },
    })}\n`;
    const path = await writeTranscript(heavyTranscript() + mention);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(Decision.parse(JSON.parse(out)).decision).toBe("block");
  });

  test("still blocks when the marker only appears inside a tool payload", async () => {
    const markerEdit = `${JSON.stringify({
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: "/repo/hook.ts", content: 'const MARKER = "comment-density:";' },
          },
        ],
      },
    })}\n`;
    const path = await writeTranscript(heavyTranscript() + markerEdit);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(Decision.parse(JSON.parse(out)).decision).toBe("block");
  });

  test("stays silent when a prior block's hook attachment carries the marker", async () => {
    const attachment = `${JSON.stringify({
      attachment: {
        type: "hook_blocking_error",
        hookName: "Stop",
        hookEvent: "Stop",
        stdout: '{"decision":"block","reason":"comment-density: prior block"}',
      },
    })}\n`;
    const path = await writeTranscript(heavyTranscript() + attachment);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(out).toBe("");
  });

  test("stays silent when a prior block's reason sits in blockingError", async () => {
    const attachment = `${JSON.stringify({
      attachment: {
        type: "hook_blocking_error",
        hookName: "Stop",
        hookEvent: "Stop",
        blockingError: {
          blockingError: "comment-density: this session's added comments run over the baseline.",
          command: "bun hooks/density.ts",
        },
      },
    })}\n`;
    const path = await writeTranscript(heavyTranscript() + attachment);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(out).toBe("");
  });

  test("stays silent when a prior block's blockingError is a bare string", async () => {
    const attachment = `${JSON.stringify({
      attachment: {
        type: "hook_blocking_error",
        hookName: "Stop",
        hookEvent: "Stop",
        blockingError: "comment-density: this session's added comments run over the baseline.",
      },
    })}\n`;
    const path = await writeTranscript(heavyTranscript() + attachment);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(out).toBe("");
  });

  test("still blocks when a non-Stop hook's stdout mentions the marker", async () => {
    const attachment = `${JSON.stringify({
      attachment: {
        type: "hook_success",
        hookName: "PostToolUse",
        hookEvent: "PostToolUse",
        stdout: "linted a file mentioning comment-density: in its source",
      },
    })}\n`;
    const path = await writeTranscript(heavyTranscript() + attachment);
    const out = await runHook({ hook_event_name: "Stop", transcript_path: path });
    expect(Decision.parse(JSON.parse(out)).decision).toBe("block");
  });

  test("stays silent when a prior block reason appears as a text content block", async () => {
    const marker = `${JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "text", text: "Stop hook feedback:\n[density]: comment-density: prior block" },
        ],
      },
    })}\n`;
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
