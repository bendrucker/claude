import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";

const Decision = z.object({ decision: z.string(), reason: z.string() });

const HOOK = join(import.meta.dirname, "density.ts");

const comment = (i: number) =>
  `// Explains step ${i} of the procedure in far more prose than the line below needs to justify.`;

const heavy = (count: number, commented = count) =>
  `${Array.from({ length: count }, (_, i) =>
    i < commented ? `${comment(i)}\nconst step${i} = ${i};` : `const step${i} = ${i};`,
  ).join("\n")}\n`;

let repo: string;
let transcripts: string;

/** A branch off `main` whose working tree carries a comment-heavy new file. */
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "density-hook-repo-"));
  transcripts = await mkdtemp(join(tmpdir(), "density-hook-"));
  const git = $.cwd(repo).env({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" });
  await git`git init -b main`.quiet();
  await git`git config user.email test@example.com`.quiet();
  await git`git config user.name Test`.quiet();
  await Bun.write(join(repo, "base.ts"), "const base = 1;\n");
  await git`git add -A`.quiet();
  await git`git commit -m init`.quiet();
  await git`git checkout -b work`.quiet();
  await Bun.write(join(repo, "heavy.ts"), heavy(40));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(transcripts, { recursive: true, force: true });
});

const edit = (path: string, input: Record<string, unknown> = {}) =>
  `${JSON.stringify({
    message: {
      content: [{ type: "tool_use", name: "Edit", input: { file_path: path, ...input } }],
    },
  })}\n`;

const heavyTranscript = () => edit(join(repo, "heavy.ts"));

async function writeTranscript(content: string): Promise<string> {
  const path = join(transcripts, `${Math.random()}.jsonl`);
  await Bun.write(path, content);
  return path;
}

async function runHook(input: Record<string, unknown>): Promise<string> {
  const proc = Bun.spawn(["bun", HOOK], { stdin: "pipe", stdout: "pipe" });
  await proc.stdin.write(JSON.stringify({ cwd: repo, ...input }));
  await proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return out;
}

async function stop(content: string): Promise<string> {
  const path = await writeTranscript(content);
  return runHook({ hook_event_name: "Stop", transcript_path: path });
}

describe("density Stop hook", () => {
  test("blocks a strong-tier branch with a marked reason", async () => {
    const decision = Decision.parse(JSON.parse(await stop(heavyTranscript())));
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

  test("stays silent once the comments are trimmed out of the tree", async () => {
    expect(await stop(heavyTranscript())).not.toBe("");
    await Bun.write(join(repo, "heavy.ts"), heavy(40, 0));
    expect(await stop(heavyTranscript())).toBe("");
  });

  test("reports the same excess however many edits wrote the file", async () => {
    const once = await stop(heavyTranscript());
    expect(once).not.toBe("");
    const trimPass = Array.from({ length: 20 }, (_, i) =>
      edit(join(repo, "heavy.ts"), { old_string: comment(i), new_string: `// step ${i}` }),
    ).join("");
    expect(await stop(heavyTranscript() + trimPass)).toBe(once);
  });

  test("stays silent when the session's edits land outside the repo", async () => {
    expect(await stop(edit(join(transcripts, "elsewhere.ts")))).toBe("");
  });

  test("stays silent when the branch matches its base", async () => {
    await rm(join(repo, "heavy.ts"));
    expect(await stop(heavyTranscript())).toBe("");
  });

  test("stays silent when the tail carries relayed Stop-hook feedback", async () => {
    const marker = `${JSON.stringify({
      type: "user",
      message: { content: "Stop hook feedback:\n[density]: comment-density: prior block" },
    })}\n`;
    expect(await stop(heavyTranscript() + marker)).toBe("");
  });

  test("stays silent when the prior block scrolled out of the transcript tail", async () => {
    const marker = `${JSON.stringify({
      type: "user",
      message: { content: "Stop hook feedback:\n[density]: comment-density: prior block" },
    })}\n`;
    const since = Array.from(
      { length: 500 },
      (_, i) => `${JSON.stringify({ type: "user", message: { content: `turn ${i}` } })}\n`,
    ).join("");
    expect(await stop(heavyTranscript() + marker + since)).toBe("");
  });

  test("still blocks when ordinary message text mentions the marker", async () => {
    const mention = `${JSON.stringify({
      type: "user",
      message: { content: "let's rename the comment-density: marker constant" },
    })}\n`;
    const out = await stop(heavyTranscript() + mention);
    expect(Decision.parse(JSON.parse(out)).decision).toBe("block");
  });

  test("still blocks when the marker only appears inside a tool payload", async () => {
    const markerEdit = `${JSON.stringify({
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: join(repo, "hook.ts"), content: 'const M = "comment-density:";' },
          },
        ],
      },
    })}\n`;
    const out = await stop(heavyTranscript() + markerEdit);
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
    expect(await stop(heavyTranscript() + attachment)).toBe("");
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
    expect(await stop(heavyTranscript() + attachment)).toBe("");
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
    expect(await stop(heavyTranscript() + attachment)).toBe("");
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
    const out = await stop(heavyTranscript() + attachment);
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
    expect(await stop(heavyTranscript() + marker)).toBe("");
  });

  test("stays silent on a clean session", async () => {
    await Bun.write(join(repo, "clean.ts"), "const x = 1;\n");
    expect(await stop(edit(join(repo, "clean.ts")))).toBe("");
  });
});
