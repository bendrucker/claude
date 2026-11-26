import { describe, expect, test } from "bun:test";
import { normalizeMcpName, ruleViolations } from "./check-permission-rules";

const terraform = { plugin: "terraform", server: "terraform" };

describe("ruleViolations", () => {
  test.each<{ name: string; rules: string[]; expected: number }>([
    { name: "Write routes through Edit", rules: ["Write(/tmp/**)"], expected: 1 },
    { name: "Edit is the live form", rules: ["Edit(/tmp/**)"], expected: 0 },
    { name: "wildcard in an assigned value", rules: ["Bash(PORT=* npm run dev)"], expected: 1 },
    { name: "literal assigned value", rules: ["Bash(PORT=3000 npm run dev)"], expected: 0 },
    { name: "wildcard after the command", rules: ["Bash(npm run *)"], expected: 0 },
    { name: "bare plugin-hosted server", rules: ["mcp__terraform"], expected: 1 },
    { name: "one tool of a plugin-hosted server", rules: ["mcp__terraform__list"], expected: 1 },
    {
      name: "plugin-prefixed spelling",
      rules: ["mcp__plugin_terraform_terraform__*"],
      expected: 0,
    },
    { name: "server sharing only a prefix", rules: ["mcp__terraform_cloud"], expected: 0 },
  ])("$name", ({ rules, expected }) => {
    expect(ruleViolations(rules, [terraform])).toHaveLength(expected);
  });

  test("names the plugin-prefixed replacement, keeping the tool", () => {
    expect(ruleViolations(["mcp__terraform__list"], [terraform])).toEqual([
      "mcp__terraform__list (plugin terraform hosts this server, so use mcp__plugin_terraform_terraform__list)",
    ]);
  });
});

test("normalizeMcpName replaces characters a tool name cannot hold", () => {
  expect(normalizeMcpName("my.server name")).toBe("my_server_name");
});
