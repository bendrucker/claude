import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type Descriptor,
  expandHome,
  fullLabel,
  groupPrefix,
  listDescriptors,
  parseDescriptor,
  planReconcile,
  renderPlist,
} from "./scheduled";

function extractString(xml: string, key: string): string {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  if (!match) throw new Error(`key not found in plist: ${key}`);
  return match[1];
}

function extractCalendarInterval(xml: string): Record<string, number> {
  const block = xml.match(/<key>StartCalendarInterval<\/key>\s*<dict>([\s\S]*?)<\/dict>/);
  if (!block) throw new Error("StartCalendarInterval dict not found");
  const entries: Record<string, number> = {};
  for (const m of block[1].matchAll(/<key>(\w+)<\/key>\s*<integer>(-?\d+)<\/integer>/g)) {
    entries[m[1]] = Number(m[2]);
  }
  return entries;
}

const discoverDescriptor: Descriptor = {
  label: "discover",
  schedule: { weekday: "mon", at: "07:23" },
  mode: "headless",
  command: "/improve-claude-code discover --scheduled",
  workdir: "~/src/bendrucker/claude",
};

describe("renderPlist", () => {
  test("renders the discover descriptor", () => {
    const xml = renderPlist(discoverDescriptor, "home");

    expect(extractString(xml, "Label")).toBe("me.bendrucker.claude.home.discover");

    const workdir = extractString(xml, "WorkingDirectory");
    expect(workdir).toBe(join(homedir(), "src/bendrucker/claude"));
    expect(workdir.startsWith("/")).toBe(true);
    expect(workdir).not.toContain("~");
    expect(workdir).not.toContain("$HOME");

    expect(extractCalendarInterval(xml)).toEqual({ Weekday: 1, Hour: 7, Minute: 23 });

    expect(xml).toContain(
      'claude -p "/improve-claude-code discover --scheduled" --permission-mode acceptEdits',
    );
  });

  test("defaults permission_mode to acceptEdits", () => {
    const xml = renderPlist(discoverDescriptor, "home");
    expect(xml).toContain("--permission-mode acceptEdits");
  });

  test("honors an explicit permission_mode", () => {
    const xml = renderPlist({ ...discoverDescriptor, permission_mode: "plan" }, "home");
    expect(xml).toContain("--permission-mode plan");
  });

  test.each<{ name: string; descriptor: Partial<Descriptor>; message: string }>([
    { name: "cloud mode", descriptor: { mode: "cloud" }, message: /mode "headless"/.source },
    {
      name: "missing workdir",
      descriptor: { workdir: undefined },
      message: /missing "workdir"/.source,
    },
    {
      name: "unknown weekday",
      descriptor: { schedule: { weekday: "someday", at: "07:23" } },
      message: /unknown weekday/.source,
    },
    {
      name: "malformed time",
      descriptor: { schedule: { weekday: "mon", at: "not-a-time" } },
      message: /invalid schedule\.at/.source,
    },
  ])("rejects $name", ({ descriptor, message }) => {
    expect(() => renderPlist({ ...discoverDescriptor, ...descriptor }, "home")).toThrow(
      new RegExp(message),
    );
  });
});

describe("planReconcile", () => {
  test.each<{
    name: string;
    desired: string[];
    installed: string[];
    prefix: string;
    install: string[];
    prune: string[];
  }>([
    {
      name: "the plan's own example",
      desired: ["home.discover"],
      installed: ["home.stale"],
      prefix: "me.bendrucker.claude.home.",
      install: ["home.discover"],
      prune: ["home.stale"],
    },
    {
      name: "already installed, nothing to do",
      desired: ["home.discover"],
      installed: ["home.discover"],
      prefix: "me.bendrucker.claude.home.",
      install: [],
      prune: [],
    },
    {
      name: "never prunes another group's agents",
      desired: ["home.discover"],
      installed: ["home.discover", "work.timesheet"],
      prefix: "me.bendrucker.claude.home.",
      install: [],
      prune: [],
    },
    {
      name: "install and prune together",
      desired: ["home.a", "home.b"],
      installed: ["home.b", "home.c"],
      prefix: "me.bendrucker.claude.home.",
      install: ["home.a"],
      prune: ["home.c"],
    },
  ])("$name", ({ desired, installed, prefix, install, prune }) => {
    const plan = planReconcile(desired, installed, prefix);
    expect(plan.install).toEqual(install);
    expect(plan.prune).toEqual(prune);
    expect(plan.update).toEqual([]);
  });

  test("rejects a malformed prefix", () => {
    expect(() => planReconcile([], [], "not-a-prefix")).toThrow(/prefix must look like/);
  });
});

describe("parseDescriptor", () => {
  test("parses a full descriptor", () => {
    const descriptor = parseDescriptor(
      `label: discover
schedule: { weekday: mon, at: "07:23" }
mode: headless
command: /improve-claude-code discover --scheduled
workdir: ~/src/bendrucker/claude
`,
      "test.yaml",
    );
    expect(descriptor).toEqual(discoverDescriptor);
  });

  test.each<{ name: string; yaml: string; message: string }>([
    {
      name: "missing label",
      yaml: "schedule: { at: '07:23' }\nmode: headless\ncommand: x",
      message: 'missing "label"',
    },
    {
      name: "missing schedule.at",
      yaml: "label: x\nschedule: {}\nmode: headless\ncommand: x",
      message: 'missing "schedule.at"',
    },
    {
      name: "unknown mode",
      yaml: "label: x\nschedule: { at: '07:23' }\nmode: nonsense\ncommand: x",
      message: 'unknown "mode"',
    },
    {
      name: "missing command",
      yaml: "label: x\nschedule: { at: '07:23' }\nmode: headless",
      message: 'missing "command"',
    },
  ])("rejects $name", ({ yaml, message }) => {
    expect(() => parseDescriptor(yaml, "test.yaml")).toThrow(message);
  });
});

describe("listDescriptors", () => {
  test("reads the committed home group", async () => {
    const dir = join(import.meta.dirname, "..", "..", "..", "scheduled", "home");
    const entries = await listDescriptors(dir);
    expect(entries.map((e) => e.descriptor.label)).toContain("discover");
  });
});

describe("expandHome / fullLabel / groupPrefix", () => {
  test("expandHome resolves ~ against the home directory", () => {
    expect(expandHome("~/src/bendrucker/claude")).toBe(join(homedir(), "src/bendrucker/claude"));
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
  });

  test("fullLabel and groupPrefix compose the reverse-DNS label", () => {
    expect(fullLabel("home", "discover")).toBe("me.bendrucker.claude.home.discover");
    expect(groupPrefix("home")).toBe("me.bendrucker.claude.home.");
  });
});
