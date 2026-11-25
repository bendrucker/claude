import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const close = join(import.meta.dirname, "close.ts");
const repo = join(import.meta.dirname, "..", "..", "..", "..", "..");

function sh(argv: string[], env: Record<string, string | undefined> = process.env): string {
  const proc = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", cwd: repo, env });
  if (proc.exitCode !== 0) throw new Error(`${argv.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

async function until<T>(
  what: string,
  probe: () => T | undefined,
  end = Date.now() + 120_000,
): Promise<T> {
  const value = probe();
  if (value !== undefined) return value;
  if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  await Bun.sleep(1000);
  return until(what, probe, end);
}

const Created = z.object({
  session_id: z.string(),
  initial_windows: z.array(z.object({ block_ids: z.array(z.string()) })),
});
const NewWindow = z.object({ block_ids: z.array(z.string()).min(1) });
const Windows = z.object({
  windows: z.array(
    z.object({
      label: z.string(),
      layers: z.array(z.object({ blocks: z.array(z.object({ block_id: z.string() })) })),
    }),
  ),
});
const Process = z.object({ child: z.object({ pid: z.number() }) });

const screen = (session: string, block: string) =>
  Bun.spawnSync(["rex", "capture", "-s", session, "-b", block, "--trim", "--unwrap"], {
    stdout: "pipe",
    stderr: "ignore",
  }).stdout.toString();

const windows = (session: string) =>
  Windows.parse(JSON.parse(sh(["rex", "window", "ls", "-s", session, "--json"]))).windows;

const sessions: string[] = [];

function scratch(label: string): string {
  const created = Created.parse(JSON.parse(sh(["rex", "new", label, "--json"])));
  sessions.push(created.session_id);
  return created.session_id;
}

afterAll(() => {
  for (const session of sessions) Bun.spawnSync(["rex", "kill", session], { stderr: "ignore" });
});

const ready = Bun.which("rex") !== null && Bun.which("claude") !== null;

describe.skipIf(!ready)("relocate", () => {
  test(
    "moves a Claude tab to another Rex session with its conversation",
    async () => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const a = scratch(`relocate-a-${suffix}`);
      const b = scratch(`relocate-b-${suffix}`);
      const label = `Relocate Probe ${suffix}`;
      const word = ["PELICAN", "MARMOT", "QUOKKA", "NARWHAL", "OCELOT"][
        Math.floor(Math.random() * 5)
      ];
      const session = crypto.randomUUID();
      const dataDir = mkdtempSync(join(tmpdir(), "relocate-it-"));

      const opened = NewWindow.parse(
        JSON.parse(
          sh([
            "rex",
            "window",
            "new",
            "-s",
            a,
            label,
            "-c",
            repo,
            "--json",
            "--",
            "claude",
            "--model",
            "haiku",
            "--session-id",
            session,
            `Remember the codeword ${word}. Reply with only the word OK.`,
          ]),
        ),
      );
      const block = opened.block_ids[0] ?? "";
      await until("the OK reply", () => (/⏺\s*OK\b/.test(screen(a, block)) ? true : undefined));

      const proc = Process.parse(
        JSON.parse(
          sh([
            "rex",
            "api",
            "call",
            "-s",
            a,
            "com.superlogical.terminal.process",
            JSON.stringify({ block_id: block }),
          ]),
        ),
      );

      sh(["bun", close, "relocate", "--session", session, "--to", `relocate-b-${suffix}`], {
        ...process.env,
        HERDR_ENV: undefined,
        HC_TERMINAL_ID: undefined,
        REX_SESSION: a,
        REX_BLOCK: block,
        CLAUDE_PID: `${proc.child.pid}`,
        CLAUDE_PLUGIN_DATA: dataDir,
      });

      const moved = await until("the relocated tab", () =>
        windows(b).find((window) => window.label === label),
      );
      const target = moved.layers[0]?.blocks[0]?.block_id ?? "";
      await until("the resumed prompt", () =>
        screen(b, target).includes(`codeword ${word}`) ? true : undefined,
      );
      await Bun.sleep(2000);
      sh([
        "rex",
        "send",
        "-s",
        b,
        "-b",
        target,
        "What was the codeword? Reply with only the word.",
      ]);
      await Bun.sleep(500);
      sh(["rex", "send", "-s", b, "-b", target, "\r"]);
      await until("the recalled word", () =>
        new RegExp(`⏺\\s*${word}`).test(screen(b, target)) ? true : undefined,
      );

      expect(windows(a).some((window) => window.label === label)).toBe(false);
    },
    { timeout: 360_000 },
  );
});
