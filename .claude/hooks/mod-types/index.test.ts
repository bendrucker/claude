import { describe, expect, test } from "bun:test";
import { type Deps, processSessionStart } from ".";

const REMOTE = { CLAUDE_CODE_REMOTE: "true" };

function fake(overrides: Partial<Deps> & { exits?: Record<string, number> } = {}) {
  const calls: string[] = [];
  const deps: Deps = {
    spawn: (cmd) => {
      const joined = cmd.join(" ");
      calls.push(joined);
      return Promise.resolve(overrides.exits?.[joined] ?? 0);
    },
    hasNodeModules: () => Promise.resolve(true),
    missingTypes: () => Promise.resolve(["zsh"]),
    ...overrides,
  };
  return { deps, calls };
}

describe("processSessionStart", () => {
  test("does nothing in an installed local checkout", async () => {
    const { deps, calls } = fake();
    expect(await processSessionStart({}, deps)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("installs dependencies in a local checkout without generating types", async () => {
    const { deps, calls } = fake({ hasNodeModules: () => Promise.resolve(false) });
    const stages: string[] = [];
    const record = (stage: string) => {
      stages.push(stage);
    };
    expect(await processSessionStart({}, deps, record)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "Installed dependencies with `bun install --frozen-lockfile`.",
      },
    });
    expect(calls).toEqual(["bun install --frozen-lockfile"]);
    expect(stages).toEqual(["installed"]);
  });

  test("records a failed local install", async () => {
    const { deps } = fake({
      hasNodeModules: () => Promise.resolve(false),
      exits: { "bun install --frozen-lockfile": 1 },
    });
    const stages: string[] = [];
    const output = await processSessionStart({}, deps, (stage) => {
      stages.push(stage);
    });
    expect(output?.systemMessage).toContain("`bun install` failed");
    expect(stages).toEqual(["install-failed"]);
  });

  test("skips generation when every mod has types", async () => {
    const { deps, calls } = fake({ missingTypes: () => Promise.resolve([]) });
    expect(await processSessionStart(REMOTE, deps)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("installs dependencies before generating types", async () => {
    const { deps, calls } = fake({ hasNodeModules: () => Promise.resolve(false) });
    expect(await processSessionStart(REMOTE, deps)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "Generated mod engine types for zsh.",
      },
    });
    expect(calls).toEqual(["bun install --frozen-lockfile", "bun scripts/mod-types.ts"]);
  });

  test("reports a failed install and stops", async () => {
    const { deps, calls } = fake({
      hasNodeModules: () => Promise.resolve(false),
      exits: { "bun install --frozen-lockfile": 1 },
    });
    const output = await processSessionStart(REMOTE, deps);
    expect(output?.systemMessage).toContain("`bun install` failed");
    expect(calls).toEqual(["bun install --frozen-lockfile"]);
  });

  test("reports a failed generation", async () => {
    const { deps } = fake({ exits: { "bun scripts/mod-types.ts": 1 } });
    const output = await processSessionStart(REMOTE, deps);
    expect(output?.systemMessage).toContain("`bun run mod-types` failed");
  });
});
