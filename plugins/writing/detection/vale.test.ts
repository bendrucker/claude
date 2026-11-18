import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensurePackages,
  lintFile,
  lintProse,
  repoConfigRoot,
  sectionExtensions,
  VALE_CONFIG,
  ValeError,
  valeAlerts,
  valeBinary,
} from "./vale";

const root = join(import.meta.dirname, "..");

test.each<{ name: string; args: string[] }>([
  {
    name: "every Writing rule passes its own cases and matches at least one",
    args: ["test", "--coverage", join(root, "styles", "Writing")],
  },
  {
    name: "the plugin config passes its project cases",
    args: ["--no-global", `--config=${join(root, ".vale.ini")}`, "test", join(root, "tests")],
  },
])("$name", async ({ args }) => {
  const binary = valeBinary();
  expect(binary).not.toBeNull();
  const proc = Bun.spawn([binary ?? "vale", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({
    exitCode: 0,
    output: "",
  });
});

// The ai-tells packages ship every check at error, which denies a message, so a package bump must not add one unlevelled.
test.each(["ai-tells", "ai-tells-commits"])(
  "every %s check has a level in the plugin config",
  async (style) => {
    await ensurePackages(valeBinary() ?? "vale");
    const checks = await Array.fromAsync(
      new Bun.Glob("*.yml").scan({ cwd: join(root, "styles", style) }),
    );
    const config = await Bun.file(VALE_CONFIG).text();
    const levelled = new Set(config.match(new RegExp(`^${style}\\.\\w+(?= = )`, "gm")));
    const unlevelled = checks
      .map((file) => `${style}.${file.replace(/\.yml$/, "")}`)
      .filter((check) => !levelled.has(check))
      .toSorted();
    expect(checks.length).toBeGreaterThan(0);
    expect(unlevelled).toEqual([]);
  },
);

// Vale 3.27 reads code comments through grammars `vale sync` installs, which an older sync of the same packages lacks.
test("a Vale upgrade re-syncs packages already installed", async () => {
  const binary = valeBinary() ?? "vale";
  const stamp = join(root, "styles", ".synced-vale");
  await Bun.write(stamp, "vale version 0.0.0");
  await ensurePackages(binary);
  const version = (await new Response(Bun.spawn([binary, "--version"]).stdout).text()).trim();
  expect(await Bun.file(stamp).text()).toBe(version);
});

describe("lintProse", () => {
  const text = "Hi Dana, the cache starts cold; the first request fills it.";

  test.each<{
    name: string;
    path: string | undefined;
    message: boolean;
    check: string;
    fires: boolean;
  }>([
    {
      name: "a prose file gets the file rules",
      path: "notes.md",
      message: false,
      check: "ai-tells.SemicolonUsage",
      fires: true,
    },
    {
      name: "a prose file skips the message rules",
      path: "notes.md",
      message: false,
      check: "Writing.Salutation",
      fires: false,
    },
    {
      name: "a code file gets the code rules",
      path: "script.ts",
      message: false,
      check: "ai-tells.SemicolonUsage",
      fires: false,
    },
    {
      name: "no path lints as a message",
      path: undefined,
      message: false,
      check: "Writing.Salutation",
      fires: true,
    },
    {
      name: "a message flag overrides the path",
      path: "notes.md",
      message: true,
      check: "Writing.Salutation",
      fires: true,
    },
  ])("$name", async ({ path, message, check, fires }) => {
    const checks = (await lintProse(text, path, { message })).map((alert) => alert.Check);
    expect(checks.includes(check)).toBe(fires);
  });

  test("sorts by line, then column", async () => {
    const alerts = await lintProse("We reach for it — here.\nWe reach for more.");
    const positions = alerts.map((alert) => [alert.Line, alert.Span[0]]);
    expect(positions).toEqual(
      positions.toSorted(([al = 0, ac = 0], [bl = 0, bc = 0]) => (al === bl ? ac - bc : al - bl)),
    );
    expect(positions.length).toBeGreaterThan(1);
  });
});

// A global config's `[*]` section once merged into the plugin's and linted CSS in an SVG `<style>` as prose.
describe("a global config beside the plugin's", () => {
  let home: string;
  const keys = ["NODE_ENV", "XDG_CONFIG_HOME"] as const;
  const saved = new Map(keys.map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "vale-global-"));
    await Bun.write(
      join(home, "vale", ".vale.ini"),
      `StylesPath = ${join(root, "styles")}\n[*]\nBasedOnStyles = ai-tells\n`,
    );
    process.env.NODE_ENV = "production";
    process.env.XDG_CONFIG_HOME = home;
  });

  afterAll(async () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  });

  test("leaves a file no plugin section matches unlinted", async () => {
    const svg = join(home, "badge.svg");
    await Bun.write(
      svg,
      '<svg><style>.cap { font-size: 12px; letter-spacing: 1.2px; }</style><text style="fill: red; font-size: 9px;">Hi</text></svg>\n',
    );
    expect(await lintFile(svg)).toEqual([]);
  });
});

describe("sectionExtensions", () => {
  test.each<{ name: string; ini: string; extensions: string[] | null }>([
    {
      name: "reads single and braced globs, ignoring [formats]",
      ini: "[formats]\nprbody = md\n[*.md]\nA = YES\n[*.{ts,py}]\nB = NO\n",
      extensions: ["md", "py", "ts"],
    },
    { name: "gives up on a directory glob", ini: "[*.md]\n[docs/*.txt]\n", extensions: null },
    { name: "gives up on a catch-all", ini: "[*]\n", extensions: null },
  ])("$name", ({ ini, extensions }) => {
    const found = sectionExtensions(ini);
    expect(found === null ? null : [...found].toSorted()).toEqual(extensions);
  });

  test("the plugin config lints markdown and TypeScript but not reStructuredText", async () => {
    const found = sectionExtensions(await Bun.file(VALE_CONFIG).text());
    expect([found?.has("md"), found?.has("ts"), found?.has("rst")]).toEqual([true, true, false]);
  });
});

describe("a file no plugin section matches", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vale-skip-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test.each(["data.json", "notes.rst", "Makefile", "run.sh"])(
    "%s lints without spawning Vale",
    async (name) => {
      const path = join(dir, name);
      await Bun.write(path, "The cache starts cold; the first request fills it.\n");
      const spawn = spyOn(Bun, "spawn");
      try {
        expect(await lintFile(path)).toEqual([]);
        expect(await valeAlerts("The cache starts cold; it fills.", { filePath: path })).toEqual(
          [],
        );
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        spawn.mockRestore();
      }
    },
  );
});

// Each worktree holds its own copy of the plugin, whose `styles/` never had the packages synced.
describe("a file inside a copy of this plugin", () => {
  let copy: string;
  beforeAll(async () => {
    await ensurePackages(valeBinary() ?? "vale");
    copy = join(mkdtempSync(join(tmpdir(), "vale-worktree-")), "plugins", "writing");
    await mkdir(join(copy, "styles"), { recursive: true });
    await Bun.write(join(copy, ".claude-plugin", "plugin.json"), '{ "name": "writing" }\n');
    await Bun.write(join(copy, ".vale.ini"), Bun.file(VALE_CONFIG));
  });
  afterAll(async () => {
    await rm(join(copy, "..", ".."), { recursive: true, force: true });
  });

  test("is not an adopted repo config", async () => {
    expect(await repoConfigRoot(join(copy, "README.md"))).toBeNull();
  });

  test("lints under the running plugin's config without E201", async () => {
    const path = join(copy, "README.md");
    await Bun.write(path, "The cache starts cold; the first request fills it.\n");
    const checks = (await lintFile(path)).map((alert) => alert.Check);
    expect(checks).toContain("ai-tells.SemicolonUsage");
  });
});

describe("a repo's own config", () => {
  let repo: string;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vale-repo-"));
    await mkdir(join(repo, "styles"));
    await Bun.write(
      join(repo, ".vale.ini"),
      "StylesPath = styles\n[docs/*.md]\nBasedOnStyles = Vale\n",
    );
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  test.each<{ name: string; path: string; fires: boolean }>([
    { name: "a file its directory section matches", path: "docs/guide.md", fires: true },
    { name: "a file outside that directory", path: "notes/guide.md", fires: false },
  ])("lints $name", async ({ path, fires }) => {
    const checks = (await valeAlerts("The the cache.", { filePath: join(repo, path) })).map(
      (alert) => alert.Check,
    );
    expect(checks.includes("Vale.Repetition")).toBe(fires);
  });

  // Vale merges the global config with a repo's, so only Vale knows what a repo config lints.
  test("lints an extension the plugin config does not", async () => {
    const notes = join(repo, "notes");
    await mkdir(join(notes, "styles"), { recursive: true });
    await Bun.write(
      join(notes, ".vale.ini"),
      "StylesPath = styles\n[formats]\nnotes = md\n[*.notes]\nBasedOnStyles = Vale\n",
    );
    const checks = (await valeAlerts("The the cache.", { filePath: join(notes, "a.notes") })).map(
      (alert) => alert.Check,
    );
    expect(checks).toContain("Vale.Repetition");
  });

  test("throws a runtime failure with Vale's error code", async () => {
    const broken = mkdtempSync(join(tmpdir(), "vale-broken-"));
    await Bun.write(
      join(broken, ".vale.ini"),
      "StylesPath = missing\n[*.md]\nBasedOnStyles = Vale\n",
    );
    const failure = await valeAlerts("Plain.", { filePath: join(broken, "a.md") }).catch(
      (error: unknown) => error,
    );
    await rm(broken, { recursive: true, force: true });
    expect(failure).toBeInstanceOf(ValeError);
    expect(failure).toMatchObject({ code: "E201" });
  });
});
