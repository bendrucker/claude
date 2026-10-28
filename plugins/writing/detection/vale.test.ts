import { expect, test } from "bun:test";
import { join } from "node:path";
import { valeBinary } from "./vale";

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
