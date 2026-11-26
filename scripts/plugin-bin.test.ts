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

const binPlugins = [...new Set(shims.map((path) => basename(join(path, "..", ".."))))];
const CHECK_SCRIPT = "scripts/bin-path-check.sh";

test.each(binPlugins)("%s carries the bin-path-check copy", async (plugin) => {
  const [canonical, copy] = await Promise.all([
    Bun.file(join(root, "plugins/dispatch", CHECK_SCRIPT)).text(),
    Bun.file(join(root, "plugins", plugin, CHECK_SCRIPT)).text(),
  ]);
  expect(copy).toBe(canonical);
});

// A session that predates a shim's deploy lacks it on PATH, so each skill that references one checks first.
const skillDirs = binPlugins.flatMap((plugin) =>
  globSync(`plugins/${plugin}/skills/*/SKILL.md`, { cwd: root }).map((path) => ({
    plugin,
    dir: join(root, path, ".."),
  })),
);

describe.each(skillDirs.map(({ plugin, dir }) => [`${plugin}:${basename(dir)}`, plugin, dir]))(
  "%s",
  (_name, plugin, dir) => {
    test("checks PATH for every shim it names", async () => {
      const skill = await Bun.file(join(dir, "SKILL.md")).text();
      const references = await Promise.all(
        globSync("references/**/*.md", { cwd: dir }).map((path) =>
          Bun.file(join(dir, path)).text(),
        ),
      );
      const text = [skill, ...references].join("\n");
      const named = shims
        .filter((path) => path.startsWith(join(root, "plugins", plugin, "bin")))
        .map((path) => basename(path))
        .filter((shim) => new RegExp(`(^|[\\s\`(])${shim}([\\s\`:)]|$)`, "m").test(text));
      const preflights = [
        ...skill.matchAll(
          /^!`(sh "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/bin-path-check\.sh") ([^`]+)`$/gm,
        ),
      ];
      const checked = new Set(preflights.flatMap((match) => match[2]?.split(" ") ?? []));
      expect(named.filter((shim) => !checked.has(shim))).toEqual([]);
      for (const [, command] of preflights) {
        const granted = skill.includes(`Bash(${command}:*)`) || /^ {2}- "?Bash"?$/m.test(skill);
        expect(granted).toBe(true);
      }
    });
  },
);

const SYSTEM_COMMANDS = new Set([
  "git",
  "wt",
  "claude",
  "claude-sync",
  "dotfiles-sync",
  "agent-browser",
  "open",
  "osascript",
]);

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
