import { describe, expect, test } from "bun:test";
import { isPersonalRepo, parseGhLogin, parseRemote } from "./repo";

describe("parseRemote", () => {
  test.each<[string, { host: string; owner: string } | null]>([
    ["git@github.com:bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["https://github.com/bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["ssh://git@github.com/bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["https://gitlab.com/group/subgroup/project.git", { host: "gitlab.com", owner: "group" }],
    [
      "git@github.mycorp.com:bendrucker/service.git",
      { host: "github.mycorp.com", owner: "bendrucker" },
    ],
    ["https://GitHub.com/bendrucker/claude.git", { host: "github.com", owner: "bendrucker" }],
    ["/Users/ben/src/claude", null],
  ])("parseRemote(%p) -> %p", (url, expected) => {
    expect(parseRemote(url)).toEqual(expected);
  });
});

describe("parseGhLogin", () => {
  test.each<[string, string, string | null]>([
    [
      "reads the user under github.com",
      "github.com:\n    user: bendrucker\n    git_protocol: ssh\n",
      "bendrucker",
    ],
    ["strips quotes around the value", 'github.com:\n    user: "bendrucker"\n', "bendrucker"],
    [
      "skips another host's user",
      "ghe.example.com:\n    user: someone\ngithub.com:\n    user: bendrucker\n",
      "bendrucker",
    ],
    ["returns null without a github.com block", "ghe.example.com:\n    user: someone\n", null],
    ["returns null when the block has no user", "github.com:\n    git_protocol: ssh\n", null],
    ["returns null for an empty file", "", null],
  ])("%s", (_name, hosts, expected) => {
    expect(parseGhLogin(hosts)).toBe(expected);
  });
});

describe("isPersonalRepo", () => {
  const hosts = "github.com:\n    user: bendrucker\n";

  test.each<[string, string | null, string | null, boolean]>([
    ["matches the authenticated login", "git@github.com:bendrucker/claude.git", hosts, true],
    ["matches regardless of case", "git@github.com:BenDrucker/claude.git", hosts, true],
    ["rejects another owner", "git@github.com:anthropics/claude.git", hosts, false],
    [
      "rejects a matching owner on another host",
      "git@github.mycorp.com:bendrucker/service.git",
      hosts,
      false,
    ],
    [
      "rejects a matching namespace on gitlab",
      "git@gitlab.com:bendrucker/service.git",
      hosts,
      false,
    ],
    ["skips without a remote", null, hosts, false],
    ["skips without a gh config", "git@github.com:bendrucker/claude.git", null, false],
    [
      "skips when the config holds no github.com login",
      "git@github.com:bendrucker/claude.git",
      "ghe.example.com:\n    user: someone\n",
      false,
    ],
  ])("%s", (_name, remote, hostsYaml, expected) => {
    expect(isPersonalRepo(remote, hostsYaml)).toBe(expected);
  });
});
