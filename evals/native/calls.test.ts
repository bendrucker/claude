import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls, shortPath, tally } from "./calls";

const use = (name: string, input: Record<string, string>) => ({
  type: "assistant",
  message: {
    content: [
      { type: "text", text: "references/surfaces.md" },
      { type: "tool_use", name, input },
    ],
  },
});

const trace = (...lines: object[]) =>
  [
    { type: "user", message: "Use references/surfaces.md" },
    ...lines,
    { type: "result", result: "done" },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");

test.each([
  { path: "/private/tmp/e-abc/home/cwd/src/a.ts", short: "src/a.ts" },
  {
    path: "/tmp/hc-1/plugins/writing/skills/x/references/s.md",
    short: "writing/skills/x/references/s.md",
  },
  { path: "/etc/hosts", short: "/etc/hosts" },
])("shortPath($path)", ({ path, short }) => {
  expect(shortPath(path)).toBe(short);
});

test("names reads and skill loads, ignoring a filename in injected text", () => {
  expect(
    calls(
      trace(
        use("Skill", { skill: "writing:no-diary" }),
        use("Read", {
          file_path: "/tmp/hc/plugins/writing/skills/no-diary/references/surfaces.md",
        }),
        use("Bash", { command: "cat references/surfaces.md" }),
      ),
    ),
  ).toEqual([
    "Skill writing:no-diary",
    "Read writing/skills/no-diary/references/surfaces.md",
    "Bash",
  ]);
  expect(calls(trace())).toEqual([]);
});

test("counts runs per case and arm that made each call once or more", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calls-"));
  const skill = use("Skill", { skill: "tdd" });
  await Promise.all([
    Bun.write(join(dir, "traces/c-with-0.jsonl"), trace(skill, skill)),
    Bun.write(join(dir, "traces/c-with-1.jsonl"), trace()),
    Bun.write(join(dir, "traces/c-without-0.jsonl"), trace()),
  ]);
  const cells = await tally([dir]);
  expect(cells.get("c/with")).toEqual({ runs: 2, calls: new Map([["Skill tdd", 1]]) });
  expect(cells.get("c/without")).toEqual({ runs: 1, calls: new Map() });
});
