import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Alert, apply, introduced, type Lint, preflight } from "./job";

function alert(fields: Partial<Alert> & Pick<Alert, "Check" | "Match">): Alert {
  return { Message: "m", Line: 1, Span: [1, 2], Severity: "warning", ...fields };
}

/** A lint that reports one alert per occurrence of each phrase in a file. */
function phrases(checks: Record<string, Alert["Severity"]>): Lint {
  return async (_config, paths) => {
    const entries = await Promise.all(
      paths.map(async (path): Promise<[string, Alert[]]> => {
        const text = await Bun.file(path).text();
        const alerts = Object.entries(checks).flatMap(([phrase, Severity]) =>
          text
            .split(phrase)
            .slice(1)
            .map(() => alert({ Check: `Test.${phrase}`, Match: phrase, Severity })),
        );
        return [path, alerts];
      }),
    );
    return new Map(entries.filter(([, alerts]) => alerts.length > 0));
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vale-fix-test-"));
  await Promise.all(Object.entries(files).map(([name, text]) => Bun.write(join(dir, name), text)));
  return dir;
}

describe("introduced", () => {
  test("matches by check and text, so a moved alert is not new", () => {
    const before = [alert({ Check: "A", Match: "x", Line: 1 })];
    const after = [
      alert({ Check: "A", Match: "x", Line: 9 }),
      alert({ Check: "A", Match: "x", Line: 10 }),
    ];
    expect(introduced(before, after)).toEqual([after[1]!]);
  });
});

describe("preflight and apply", () => {
  const lint = phrases({ delve: "warning", very: "suggestion" });

  async function run(files: Record<string, string>) {
    const dir = await fixture(files);
    const result = await preflight({
      config: join(dir, ".vale.ini"),
      paths: [dir],
      level: "warning",
      model: "sonnet",
      jobRoot: join(dir, "jobs"),
      lint: async (config) =>
        lint(
          config,
          Object.keys(files).map((name) => join(dir, name)),
        ),
    });
    return { dir, result };
  }

  test("shards only files with an alert at the level", async () => {
    const { result } = await run({
      "a.md": "We delve.",
      "b.md": "A very plain line.",
      "c.md": "Clean.",
    });
    expect(result).toMatchObject({ files: 1, alerts: 1 });
    const names = await readdir(result.jobDir);
    expect(names.filter((name) => name.startsWith("shard-"))).toEqual(["shard-0.json"]);
  });

  test("classifies each rewrite and restores one that added an alert", async () => {
    const { dir, result } = await run({
      "fixed.md": "We delve.",
      "partial.md": "We delve. They delve.",
      "worse.md": "We delve.",
      "same.md": "We delve.",
    });
    await Bun.write(join(dir, "fixed.md"), "We look.");
    await Bun.write(join(dir, "partial.md"), "We look. They delve.");
    // A suggestion-level alert still counts as introduced, even below the fix level.
    await Bun.write(join(dir, "worse.md"), "We look very hard.");

    const outcomes = await apply(result.jobDir, lint);
    const status = Object.fromEntries(
      outcomes.map((o) => [o.file.slice(dir.length + 1), o.status]),
    );
    expect(status).toEqual({
      "fixed.md": "fixed",
      "partial.md": "partial",
      "same.md": "untouched",
      "worse.md": "restored",
    });
    expect(await Bun.file(join(dir, "worse.md")).text()).toBe("We delve.");
    expect(outcomes.find((o) => o.status === "restored")?.added).toEqual(["1:Test.very 'very'"]);
  });
});
