import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "../../scripts/hook-input";
import { denyReason, processInput } from "./index";

let root: string;
let main: string;
let worktree: string;

function git(...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { stdout: "ignore", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function mountInput(mountPath: unknown, cwd?: string): HookInput {
  const input: HookInput = {
    session_id: "test",
    hook_event_name: "PreToolUse",
    tool_name: "mcp__plugin_1password_1password__create_local_env_file",
    tool_input: { environmentName: "app", mountPath },
  };
  if (cwd != null) input.cwd = cwd;
  return input;
}

function reasonFor(mountPath: string, cwd?: string): string | undefined {
  const output = processInput(mountInput(mountPath, cwd));
  const specific = output?.hookSpecificOutput;
  return specific?.hookEventName === "PreToolUse" ? specific.permissionDecisionReason : undefined;
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "onepassword-mount-")));
  main = join(root, "app");
  worktree = join(root, "worktrees", "feature");
  git("init", "-q", main);
  git(
    "-C",
    main,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  git("-C", main, "worktree", "add", "-q", "-b", "feature", worktree);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("processInput", () => {
  test.each<{ name: string; mountPath: () => string | undefined }>([
    { name: "main checkout", mountPath: () => join(main, ".env") },
    { name: "outside any repository", mountPath: () => join(root, ".env") },
    { name: "relative path without a cwd", mountPath: () => ".env" },
    { name: "missing path", mountPath: () => undefined },
  ])("allows $name", ({ mountPath }) => {
    expect(processInput(mountInput(mountPath()))).toBeNull();
  });

  test.each<{ name: string; segments: string[] }>([
    { name: "worktree root", segments: [".dev.vars"] },
    { name: "subdirectory that does not exist yet", segments: ["services", "api", ".env"] },
  ])("denies a linked worktree's $name and names the main checkout's path", ({ segments }) => {
    const mountPath = join(worktree, ...segments);
    expect(reasonFor(mountPath)).toBe(denyReason(mountPath, join(main, ...segments)));
  });
});

test("resolves a relative mount path against the session cwd", () => {
  expect(reasonFor(".dev.vars", worktree)).toBe(
    denyReason(join(worktree, ".dev.vars"), join(main, ".dev.vars")),
  );
});

describe("denyReason", () => {
  it("gives the link command when the main checkout is known", () => {
    expect(denyReason("/w/.env", "/m/.env")).toContain("`ln -s '/m/.env' '/w/.env'`");
  });

  it("quotes paths holding spaces and single quotes", () => {
    expect(denyReason("/w x/.env", "/m'1/.env")).toContain(`\`ln -s '/m'\\''1/.env' '/w x/.env'\``);
  });

  it("falls back to general guidance for a bare repository", () => {
    expect(denyReason("/w/.env", null)).toContain("main checkout instead");
  });
});
