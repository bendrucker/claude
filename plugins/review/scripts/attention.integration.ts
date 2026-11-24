import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

const attention = join(import.meta.dirname, "attention.ts");
const stateDir = join(homedir(), ".local", "state", "rex-review");

function sh(...argv: string[]): string {
  const proc = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`${argv.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

const ready =
  Bun.which("rex") !== null &&
  Bun.spawnSync(["rex", "actions"], { stdout: "pipe" })
    .stdout.toString()
    .includes("review_changes");

async function until<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  end = Date.now() + 10_000,
): Promise<T> {
  const value = await probe();
  if (value !== undefined) return value;
  if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  await Bun.sleep(150);
  return until(what, probe, end);
}

const ReviewState = z.object({ review: z.string() });

async function reviewBlock(agent: string): Promise<string | undefined> {
  try {
    const id = (await Bun.file(join(stateDir, "blocks", agent)).text()).trim();
    return ReviewState.parse(await Bun.file(join(stateDir, `${id}.json`)).json()).review;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

// The review's state records the split's id before Rex has created it.
function screen(block: string): string {
  return Bun.spawnSync(["rex", "capture", "-b", block, "--trim"], {
    stdout: "pipe",
    stderr: "ignore",
  }).stdout.toString();
}

const watches: Watch[] = [];

class Watch {
  readonly lines: string[] = [];
  readonly exited: Promise<number>;
  readonly kill: () => void;

  constructor(agent: string, cwd: string) {
    const proc = Bun.spawn(["bun", attention, "watch"], {
      cwd,
      env: { ...process.env, REX_BLOCK: agent },
      stdout: "pipe",
    });
    this.exited = proc.exited;
    this.kill = () => {
      proc.kill();
    };
    watches.push(this);
    void this.read(proc.stdout);
  }

  private async read(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      this.lines.push(...parts.filter((l) => l !== ""));
    }
  }

  next(prefix: string): Promise<string> {
    return until(`a ${prefix} line`, () => this.lines.find((l) => l.startsWith(prefix)));
  }
}

function open(agent: string, cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["bun", attention, "open", ...args], {
    cwd,
    env: { ...process.env, REX_BLOCK: agent },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout.toString().trim();
}

describe.skipIf(!ready)("attention under Rex", () => {
  let repo: string;
  let agent: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "review-rex-"));
    await Bun.write(join(repo, "math.js"), "export function add(a, b) {\n  return a + b;\n}\n");
    await Bun.write(
      join(repo, "design.md"),
      "# Design\n\nThe cache keeps entries for an hour.\n\nEviction is LRU.\n",
    );
    sh("git", "-C", repo, "init", "-q");
    sh("git", "-C", repo, "add", ".");
    sh("git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    await Bun.write(
      join(repo, "math.js"),
      "export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n",
    );
    agent = sh("rex", "run", "--focus=false", "--", "zsh", "-c", `cd ${repo} && exec zsh -i`);
    // review_changes reviews the directory the agent's shell last reported.
    await until("the agent shell in the repo", () =>
      sh("rex", "block", "call", "pwd", "{}", "-b", agent).includes(basename(repo))
        ? true
        : undefined,
    );
  });

  afterEach(async () => {
    for (const watch of watches.splice(0)) watch.kill();
    const split = await reviewBlock(agent);
    if (split !== undefined) Bun.spawnSync(["rex", "block", "close", split]);
  });

  afterAll(async () => {
    Bun.spawnSync(["rex", "block", "close", agent]);
    await rm(repo, { recursive: true, force: true });
  });

  test("a saved Hunk note reaches watch, and closing the split ends it", async () => {
    expect(open(agent, repo, "--diff", "--app", "hunk")).toBe(`opened Hunk beside ${agent}`);
    const watch = new Watch(agent, repo);
    const hunk = await until("the Hunk split", () => reviewBlock(agent));
    await until("Hunk's live status line", () =>
      screen(hunk).includes("live ·") ? true : undefined,
    );

    sh("rex", "send-key", "-b", hunk, "j", "j", "j", "j", "j", "j", "c");
    sh("rex", "send", "-b", hunk, "rename sub to subtract");
    sh("rex", "send-key", "-b", hunk, "ctrl+s");

    expect(await watch.next("[review: comment]")).toMatch(
      /^\[review: comment\] math\.js:\d+ \(id [^)]+\) \| .* \| rename sub to subtract$/,
    );

    sh("rex", "block", "close", hunk);
    expect(await watch.next("[review: closed]")).toMatch(/^\[review: closed\] \w+$/);
    expect(await watch.exited).toBe(0);
  }, 30_000);

  test("a plannotator document comment reaches watch, and Approve ends it", async () => {
    expect(open(agent, repo, "--doc", "design.md")).toBe(`opened plannotator-tui beside ${agent}`);
    const watch = new Watch(agent, repo);
    const tui = await until("the plannotator split", () => reviewBlock(agent));
    await until("plannotator's document", () =>
      screen(tui).includes("The cache keeps") ? true : undefined,
    );

    sh("rex", "send-key", "-b", tui, "j");
    sh("rex", "send", "-b", tui, "c");
    await until("the comment box", () => (screen(tui).includes("enter saves") ? true : undefined));
    sh("rex", "send", "-b", tui, "say how long exactly");
    sh("rex", "send-key", "-b", tui, "enter");

    expect(await watch.next("[review: comment]")).toMatch(
      /^\[review: comment\] design\.md \(id [^)]+\) \| > The cache keeps entries for an hour\. \| say how long exactly$/,
    );

    await until("the saved comment", () =>
      screen(tui).includes("comment saved") ? true : undefined,
    );
    sh("rex", "send", "-b", tui, "A");
    expect(await watch.next("[review: closed]")).toBe("[review: closed] approved");
    expect(await watch.exited).toBe(0);
  }, 30_000);
});
