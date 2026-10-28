import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lint } from "./vale";

const root = join(import.meta.dirname, "..", "..", "..");

test.each<{ name: string; args: string[] }>([
  {
    name: "every Prompting check passes its own cases and matches at least one",
    args: ["test", "--coverage", join(root, "styles", "Prompting")],
  },
  {
    name: "the plugin config passes its project cases",
    args: ["--no-global", `--config=${join(root, ".vale.ini")}`, "test", join(root, "tests")],
  },
])("$name", async ({ args }) => {
  const proc = Bun.spawn(["vale", ...args], { stdout: "pipe", stderr: "pipe" });
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

describe("lint", () => {
  let dir = "";
  const write = async (name: string, text: string): Promise<string> => {
    const path = join(dir, name);
    await Bun.write(path, text);
    return path;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "prompting-vale-"));
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("reports the source line past frontmatter", async () => {
    const path = await write("front.md", "---\nname: demo\n---\n\nTry to run it.\n");
    expect((await lint([path])).get(path)).toMatchObject([
      { Line: 5, Check: "Prompting.WeakModality" },
    ]);
  });

  test("reports the column within a soft-wrapped paragraph", async () => {
    const path = await write("wrap.md", "Read the diff first.\nThen try to summarize it.\n");
    expect((await lint([path])).get(path)).toMatchObject([{ Line: 2, Span: [6, 11] }]);
  });

  test("reports a comment at the line it opens", async () => {
    const path = await write(
      "aside.md",
      "# Doc\n\n<!--\nCuration note for maintainers. Skip this block when reviewing a document.\n-->\n",
    );
    expect((await lint([path])).get(path)).toMatchObject([
      { Line: 3, Check: "Prompting.MaintainerAside" },
    ]);
  });

  test("keys alerts by cleaned path, ordered by position", async () => {
    const clean = await write("clean.md", "Write it.\n");
    const both = await write(
      "both.md",
      "Make sure to read it. Please try.\n\nMake sure it works.\n",
    );
    const alerts = await lint([clean, `${dir}/./both.md`]);
    expect([...alerts.keys()]).toEqual([both]);
    expect(alerts.get(both)?.map((alert) => [alert.Line, alert.Span[0]])).toEqual([
      [1, 1],
      [1, 23],
      [3, 1],
    ]);
  });
});
