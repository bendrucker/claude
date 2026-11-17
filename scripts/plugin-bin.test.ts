import { describe, expect, test } from "bun:test";
import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { decodeFile } from "../packages/decode/index";
import { root } from "./assets";

const shims = globSync("plugins/*/bin/*", { cwd: root }).map((path) => join(root, path));

const TARGET = /"\$\(dirname "\$0"\)\/([^"]+)"/;

describe.each(shims.map((path) => [basename(path), path]))("%s", (_name, path) => {
  test("is executable", async () => {
    const { mode } = await Bun.file(path).stat();
    expect(mode & 0o111).toBe(0o111);
  });

  test("execs a script that exists", async () => {
    const target = TARGET.exec(await Bun.file(path).text())?.[1];
    expect(target).toBeDefined();
    expect(await Bun.file(join(path, "..", target ?? "")).exists()).toBe(true);
  });
});

test("shim names are unique across plugins", () => {
  const names = shims.map((path) => basename(path));
  expect(new Set(names).size).toBe(names.length);
});

const SYSTEM_COMMANDS = new Set(["git", "wt", "claude", "agent-browser", "open", "osascript"]);

const Settings = z.looseObject({
  sandbox: z.looseObject({ excludedCommands: z.array(z.string()) }),
});

test("every excluded plugin command has a shim", async () => {
  const settings = await decodeFile(Settings, join(root, "user/settings.json"));
  const names = new Set(shims.map((path) => basename(path)));
  const missing = settings.sandbox.excludedCommands
    .map((entry) => entry.replace(/:\*$/, ""))
    .filter((name) => !SYSTEM_COMMANDS.has(name) && !names.has(name));
  expect(missing).toEqual([]);
});
