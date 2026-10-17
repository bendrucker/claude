import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_SNIPPET, writeEnvFile } from "./sandbox-ssh-proxy";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sandbox-ssh-proxy-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sourcedSshCommand(env: Record<string, string>): string {
  const result = Bun.spawnSync(["/bin/sh", "-c", `${ENV_SNIPPET}printf %s "$GIT_SSH_COMMAND"`], {
    env,
  });
  return result.stdout.toString();
}

const SANDBOX_SSH =
  "ssh -o ControlMaster=no -o ControlPath=none -o ProxyCommand='nc -X 5 -x localhost:55739 %h %p'";

describe("ENV_SNIPPET", () => {
  it("swaps nc for ncat carrying the proxy credentials", () => {
    expect(
      sourcedSshCommand({
        GIT_SSH_COMMAND: SANDBOX_SSH,
        ALL_PROXY: "http://srt.user:secret@localhost:55739",
      }),
    ).toBe(
      "ssh -o ControlMaster=no -o ControlPath=none -o ProxyCommand='ncat --proxy 127.0.0.1:55739 --proxy-type socks5 --proxy-auth srt.user:secret %h %p'",
    );
  });

  it.each([
    [
      "the proxy has no credentials",
      { GIT_SSH_COMMAND: SANDBOX_SSH, ALL_PROXY: "http://localhost:55739" },
    ],
    [
      "the command is not the sandbox's",
      { GIT_SSH_COMMAND: "ssh -i key", ALL_PROXY: "http://u:p@localhost:1" },
    ],
  ])("leaves GIT_SSH_COMMAND alone when %s", (_, env) => {
    expect(sourcedSshCommand(env)).toBe(env.GIT_SSH_COMMAND);
  });

  it("does nothing outside the sandbox", () => {
    expect(sourcedSshCommand({})).toBe("");
  });
});

describe("writeEnvFile", () => {
  it("writes the snippet on macOS", async () => {
    const envFile = join(dir, "env");
    expect(await writeEnvFile(envFile, "darwin")).toBe(true);
    expect(await Bun.file(envFile).text()).toBe(ENV_SNIPPET);
  });

  it.each(["linux", "win32"] as const)("does nothing on %s", async (platform) => {
    const envFile = join(dir, "env");
    expect(await writeEnvFile(envFile, platform)).toBe(false);
    expect(await Bun.file(envFile).exists()).toBe(false);
  });

  it("does nothing without an env file", async () => {
    expect(await writeEnvFile(undefined, "darwin")).toBe(false);
    expect(await writeEnvFile("", "darwin")).toBe(false);
  });
});

describe("hook process", () => {
  it("records one silent metric per run", async () => {
    const proc = Bun.spawn(["bun", join(import.meta.dirname, "sandbox-ssh-proxy.ts")], {
      stdin: new Blob([JSON.stringify({ session_id: "s1", hook_event_name: "SessionStart" })]),
      env: { ...process.env, CLAUDE_ENV_FILE: join(dir, "env"), CLAUDE_HOOK_METRICS: dir },
    });
    expect(await proc.exited).toBe(0);
    const lines = (await Bun.file(join(dir, "sandbox-ssh-proxy.jsonl")).text()).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      session_id: "s1",
      hook_event: "SessionStart",
      tool: null,
      outcome: "silent",
    });
  });
});
