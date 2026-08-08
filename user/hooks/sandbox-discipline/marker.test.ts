import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasMarkedScript, scriptArguments } from "./marker";

const scratch = mkdtempSync(join(tmpdir(), "sandbox-discipline-marker-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

const marked = "marked.ts";
const plain = "plain.ts";

beforeAll(async () => {
  await Bun.write(
    join(scratch, marked),
    "#!/usr/bin/env bun\n// claude:dangerouslyDisableSandbox: opens a URL\n",
  );
  await Bun.write(join(scratch, plain), "#!/usr/bin/env bun\nconsole.log(1);\n");
});

describe("scriptArguments", () => {
  test.each<{ name: string; command: string; expected: string[] }>([
    { name: "interpreter argument", command: "bun scripts/x.ts", expected: ["scripts/x.ts"] },
    { name: "node interpreter", command: "node build/x.js", expected: ["build/x.js"] },
    { name: "direct execution", command: "./scripts/x.sh --flag", expected: ["./scripts/x.sh"] },
    { name: "env preamble", command: "FOO=1 bun x.ts", expected: ["x.ts"] },
    { name: "bun run subcommand", command: "bun run scripts/x.ts", expected: ["scripts/x.ts"] },
    { name: "interpreter flag first", command: "bun --bun x.ts", expected: ["x.ts"] },
    { name: "interpreter with no script", command: "bun --version", expected: [] },
    { name: "no script", command: "git status", expected: [] },
    { name: "compound", command: "cd /r && bun a.ts && node b.js", expected: ["a.ts", "b.js"] },
    { name: "newline separated", command: "set -e\nbun a.ts", expected: ["a.ts"] },
  ])("$name", ({ command, expected }) => {
    expect(scriptArguments(command)).toEqual(expected);
  });
});

describe("hasMarkedScript", () => {
  test("finds the marker on a script run through bun", async () => {
    expect(await hasMarkedScript(`bun ${marked}`, scratch)).toBe(true);
  });

  test("finds the marker behind a bun run subcommand", async () => {
    expect(await hasMarkedScript(`bun run ${marked}`, scratch)).toBe(true);
  });

  test("finds the marker on a script run by path", async () => {
    expect(await hasMarkedScript(join(scratch, marked))).toBe(true);
  });

  test("finds the marker behind a cd preamble", async () => {
    expect(await hasMarkedScript(`cd /elsewhere && bun ${marked}`, scratch)).toBe(true);
  });

  test("rejects an unmarked script", async () => {
    expect(await hasMarkedScript(`bun ${plain}`, scratch)).toBe(false);
  });

  test("rejects a missing script", async () => {
    expect(await hasMarkedScript("bun nope.ts", scratch)).toBe(false);
  });

  test("rejects a command that runs no script", async () => {
    expect(await hasMarkedScript("open https://example.com", scratch)).toBe(false);
  });
});
