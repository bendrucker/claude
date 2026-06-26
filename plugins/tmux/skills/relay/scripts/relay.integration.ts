import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drives relay.sh through a real tmux server: it relays a message from one
// pane to another and asserts the stamped envelope and body land in the target
// pane. Gated on tmux being installed so it no-ops where tmux is absent.
const hasTmux = Bun.which("tmux") !== null;
const relayScript = join(import.meta.dir, "relay.sh");

// Short socket dir — tmux's AF_UNIX path has a ~104-char limit, and the
// scratchpad path is too long to nest a socket under.
let socketDir: string;
let env: Record<string, string>;

function tmux(args: string[], extraEnv: Record<string, string> = {}): string {
  const proc = Bun.spawnSync(["tmux", ...args], {
    env: { ...env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`tmux ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().trim();
}

async function captureUntil(pane: string, needle: string, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let content = "";
  while (Date.now() < deadline) {
    content = tmux(["capture-pane", "-t", pane, "-p"]);
    if (content.includes(needle)) return content;
    await Bun.sleep(50);
  }
  return content;
}

describe.skipIf(!hasTmux)("relay.sh end-to-end", () => {
  beforeAll(() => {
    socketDir = mkdtempSync(join(tmpdir(), "relay-it-"));
    env = { ...process.env, TMUX_TMPDIR: socketDir } as Record<string, string>;
  });

  afterAll(() => {
    try {
      tmux(["kill-server"]);
    } catch {
      // server may already be gone
    }
    Bun.spawnSync(["rm", "-rf", socketDir]);
  });

  it("delivers a stamped multi-line envelope to the target pane", async () => {
    const session = "relay-it";
    tmux(["new-session", "-d", "-s", session, "-x", "200", "-y", "50"]);
    const src = tmux(["display-message", "-t", session, "-p", "#{pane_id}"]);
    tmux(["split-window", "-t", session, "-h", "-d"]);
    const dst = tmux(["list-panes", "-t", session, "-F", "#{pane_id}"])
      .split("\n")
      .find((id) => id !== src);
    if (!dst) throw new Error("split-window did not produce a second pane");

    const body = "Take over branch feat/x\nStart at tests/e2e.spec.ts:42";
    const proc = Bun.spawnSync(["bash", relayScript, dst, "handoff", body], {
      env: { ...env, TMUX_PANE: src },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);

    const content = await captureUntil(dst, "tmux-relay");
    // Envelope stamps the sender pane, reply target, and kind.
    expect(content).toContain(`from=${src}`);
    expect(content).toContain(`reply-to=${src}`);
    expect(content).toContain("kind=handoff");
    // Both body lines crossed the pane boundary.
    expect(content).toContain("Take over branch feat/x");
    expect(content).toContain("tests/e2e.spec.ts:42");
  });

  it("refuses to relay without a target pane", () => {
    const proc = Bun.spawnSync(["bash", relayScript], {
      env: { ...env, TMUX_PANE: "%0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr.toString()).toContain("missing target pane");
  });
});
