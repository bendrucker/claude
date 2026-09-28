import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const SESSION = "00000000-0000-4000-8000-000000000001";
const SCRIPT = join(import.meta.dirname, "watch.ts");
const Event = z.object({ event: z.string() });
/** How long a watch keeps reading after its first event. One poll reads the whole fixture, so this is ample. */
const READ_WINDOW_MS = 1000;
/** Upper bound on a watch that never prints, so a broken script fails the test instead of hanging it. */
const WATCH_CAP_MS = 20_000;

const openTurn = [
  { type: "user", promptSource: "typed", message: { content: "/hill-climb" } },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "AskUserQuestion",
          input: { questions: [{ question: "Keep it?", options: [{ label: "Keep" }] }] },
        },
      ],
    },
  },
  { type: "user", message: { content: [{ type: "tool_result", content: "Keep" }] } },
];

/** Runs one watch until it has had time to read the transcript, then stops it like a Monitor expiry. */
async function watchOnce(config: string, stateDir: string): Promise<string[]> {
  const proc = Bun.spawn(
    ["bun", SCRIPT, "watch", SESSION, "--from-start", "--state-dir", stateDir],
    {
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
      stdout: "pipe",
    },
  );
  const stop = () => {
    proc.kill();
  };
  // Startup time varies under parallel workers, so the read window opens at the first event.
  const cap = setTimeout(stop, WATCH_CAP_MS);
  let out = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stdout) {
    if (out === "") setTimeout(stop, READ_WINDOW_MS);
    out += decoder.decode(chunk);
  }
  clearTimeout(cap);
  return out
    .trim()
    .split("\n")
    .map((line) => Event.parse(JSON.parse(line)).event);
}

test("a re-armed watch does not replay a question it already reported", async () => {
  const config = await mkdtemp(join(tmpdir(), "watch-session-"));
  await mkdir(join(config, "projects", "repo"), { recursive: true });
  const transcript = openTurn.map((entry) => `${JSON.stringify(entry)}\n`).join("");
  await Bun.write(join(config, "projects", "repo", `${SESSION}.jsonl`), transcript);
  const stateDir = join(config, "state");

  expect(await watchOnce(config, stateDir)).toEqual(["watching", "blocked"]);
  expect(await watchOnce(config, stateDir)).toEqual(["watching"]);
});
