import { beforeAll, describe, expect, it } from "bun:test";
import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";

const script = join(import.meta.dirname, "../skills/shortcut/scripts/discover.swift");

// swift compiles the script on every invocation, and the first one on a cold
// runner builds the module cache from scratch. Bun's 5s default test timeout is
// tighter than the budget the subprocess itself gets, so the harness kills the
// test before swift can succeed or report its own error. Both share one budget.
const timeoutMs = 60000;
const opts: ExecFileSyncOptions = { encoding: "utf-8", timeout: timeoutMs };

const Entries = z.array(z.record(z.string(), z.unknown()));

function run(command: string): Record<string, unknown>[] {
  return Entries.parse(JSON.parse(execFileSync("swift", [script, command], opts).toString()));
}

const ci = !!process.env.CI;

describe.skipIf(ci)("discover.swift actions", () => {
  let actions: Record<string, unknown>[];

  beforeAll(() => {
    actions = run("actions");
  }, timeoutMs);

  it("returns a large array of built-in actions", () => {
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(100);
  });

  it("every entry has an identifier string", () => {
    for (const action of actions) {
      expect(action).toHaveProperty("identifier");
      expect(typeof action.identifier).toBe("string");
    }
  });

  it("includes the notification action", () => {
    const match = actions.find((a) => a.identifier === "is.workflow.actions.notification");
    expect(match).toBeDefined();
  });

  it("includes the download URL action with parameters", () => {
    const match = actions.find((a) => a.identifier === "is.workflow.actions.downloadurl");
    expect(match).toBeDefined();
    expect(Array.isArray(match?.parameters)).toBe(true);
  });

  it("parameters are arrays when present", () => {
    for (const action of actions) {
      if ("parameters" in action) {
        expect(Array.isArray(action.parameters)).toBe(true);
      }
    }
  });
});

describe.skipIf(ci)("discover.swift apps", () => {
  let apps: Record<string, unknown>[];

  beforeAll(() => {
    apps = run("apps");
  }, timeoutMs);

  it("returns an array of apps", () => {
    expect(Array.isArray(apps)).toBe(true);
  });

  it("every entry has name and path strings", () => {
    for (const app of apps) {
      expect(typeof app.name).toBe("string");
      expect(typeof app.path).toBe("string");
    }
  });

  it("includes Shortcuts", () => {
    const match = apps.find((a) => a.name === "Shortcuts");
    expect(match).toBeDefined();
  });
});

describe("discover.swift error handling", () => {
  it.each<{ name: string; args: string[] }>([
    { name: "exits non-zero with unknown command", args: [script, "invalid"] },
    { name: "exits non-zero with no arguments", args: [script] },
  ])(
    "$name",
    ({ args }) => {
      expect(() => {
        execFileSync("swift", args, { ...opts, stdio: ["pipe", "pipe", "pipe"] });
      }).toThrow();
    },
    timeoutMs,
  );
});
