import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensurePackages,
  lintFile,
  lintProse,
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

// The ai-tells package ships every check at error, which denies a message, so a package bump must not add one unlevelled.
test("every ai-tells check has a level in the plugin config", async () => {
  await ensurePackages(valeBinary() ?? "vale");
  const checks = await Array.fromAsync(
    new Bun.Glob("*.yml").scan({ cwd: join(root, "styles", "ai-tells") }),
  );
  const config = await Bun.file(VALE_CONFIG).text();
  const levelled = new Set(config.match(/^ai-tells\.\w+(?= = )/gm));
  const unlevelled = checks
    .map((file) => `ai-tells.${file.replace(/\.yml$/, "")}`)
    .filter((check) => !levelled.has(check))
    .toSorted();
  expect(checks.length).toBeGreaterThan(0);
  expect(unlevelled).toEqual([]);
});

describe("lintProse", () => {
  const dense =
    "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed. The parser rejects malformed input; it returns an error. The server validates each field. The client sends a token. The job runs nightly.";

  test.each<{ name: string; path: string | undefined; message: boolean; fires: boolean }>([
    { name: "a prose file gets the file rules", path: "notes.md", message: false, fires: true },
    { name: "a code file gets the code rules", path: "script.ts", message: false, fires: false },
    { name: "no path lints as a message", path: undefined, message: false, fires: false },
    { name: "a message flag overrides the path", path: "notes.md", message: true, fires: false },
  ])("$name", async ({ path, message, fires }) => {
    const checks = (await lintProse(dense, path, { message })).map((alert) => alert.Check);
    expect(checks.includes("Writing.SemicolonSplice")).toBe(fires);
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
