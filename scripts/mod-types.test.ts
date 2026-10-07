import { describe, expect, test } from "bun:test";
import type { Plugin } from "../packages/marketplace/index";
import { modPlugins } from "./mod-types";

function makePlugin(name: string, overrides: Partial<Plugin> = {}): Plugin {
  return { name, dir: `/repo/plugins/${name}`, enabled: true, mcpServers: [], ...overrides };
}

const withMod = { hooks: { hooks: {}, modules: ["../mod/register.ts"] } };

describe("modPlugins", () => {
  test("loads each mod plugin with the local plugins it depends on, once", () => {
    const plugins = [
      makePlugin("events", withMod),
      makePlugin("helper", { manifest: { name: "helper", dependencies: ["shared"] } }),
      makePlugin("herdr", { ...withMod, manifest: { name: "herdr", dependencies: ["events"] } }),
      makePlugin("plain"),
      { name: "remote", enabled: true, mcpServers: [], ...withMod },
      makePlugin("run", {
        ...withMod,
        manifest: { name: "run", dependencies: ["events", "helper", "elsewhere"] },
      }),
      makePlugin("shared"),
    ];

    const { mods, load } = modPlugins(plugins);

    expect(mods.map((plugin) => plugin.name)).toEqual(["events", "herdr", "run"]);
    expect(load.map((plugin) => plugin.name)).toEqual([
      "events",
      "herdr",
      "run",
      "helper",
      "shared",
    ]);
  });
});
