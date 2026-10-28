import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { lintProse, valeBinary } from "./vale";

test("every Writing rule passes its own cases and matches at least one", async () => {
  const binary = valeBinary();
  expect(binary).not.toBeNull();
  const proc = Bun.spawn(
    [binary ?? "vale", "test", "--coverage", join(import.meta.dirname, "..", "styles", "Writing")],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
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

describe("lintProse", () => {
  const dense =
    "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed. The parser rejects malformed input; it returns an error. The server validates each field. The client sends a token. The job runs nightly.";

  test.each<{ name: string; path: string | undefined; message: boolean; fires: boolean }>([
    { name: "a prose file gets the file rules", path: "notes.md", message: false, fires: true },
    { name: "a code file is skipped", path: "script.ts", message: false, fires: false },
    { name: "no path lints as a message", path: undefined, message: false, fires: false },
    { name: "a message flag overrides the path", path: "notes.md", message: true, fires: false },
  ])("$name", async ({ path, message, fires }) => {
    const checks = (await lintProse(dense, path, { message })).map((alert) => alert.Check);
    expect(checks.includes("Writing.ConnectorDensity")).toBe(fires);
  });

  test("sorts by line, then column", async () => {
    const alerts = await lintProse("We reach for it — here.\nWe reach for more.");
    const positions = alerts.map((alert) => [alert.Line, alert.Span[0]]);
    expect(positions).toEqual(
      positions.toSorted(([al = 0, ac = 0], [bl = 0, bc = 0]) => (al === bl ? ac - bc : al - bl)),
    );
    expect(positions.length).toBeGreaterThan(1);
  });

  test("drops suggestion-level alerts", async () => {
    expect(await lintProse("We delve into the tapestry.", "doc.md")).toEqual([]);
  });
});
