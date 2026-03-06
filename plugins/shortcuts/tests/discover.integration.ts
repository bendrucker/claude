import { beforeAll, describe, expect, it } from "bun:test";
import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { join } from "node:path";

const script = join(import.meta.dirname, "../skills/shortcut/scripts/discover.swift");
const opts: ExecFileSyncOptions = { encoding: "utf-8", timeout: 60000 };

function run(command: string): string {
  return execFileSync("swift", [script, command], opts) as string;
}

const ci = !!process.env.CI;

describe.skipIf(ci)("discover.swift actions", () => {
  let actions: Record<string, unknown>[];

  beforeAll(() => {
    actions = JSON.parse(run("actions")) as Record<string, unknown>[];
  });

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
    apps = JSON.parse(run("apps")) as Record<string, unknown>[];
  });

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
  it("exits non-zero with unknown command", () => {
    expect(() => {
      execFileSync("swift", [script, "invalid"], {
        ...opts,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }).toThrow();
  });

  it("exits non-zero with no arguments", () => {
    expect(() => {
      execFileSync("swift", [script], {
        ...opts,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }).toThrow();
  });
});
