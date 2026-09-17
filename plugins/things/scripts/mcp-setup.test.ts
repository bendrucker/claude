import { describe, expect, test } from "bun:test";
import {
  type ClaudeActions,
  SERVER_NAME,
  parseConfiguredUrl,
  resolveUrl,
  setup,
} from "./mcp-setup";

const URL_OK = "https://node.example.ts.net/mcp/things";

describe("resolveUrl", () => {
  test.each<[string, string | undefined, Record<string, string | undefined>]>([
    ["argument", URL_OK, {}],
    ["environment", undefined, { THINGS_MCP_URL: URL_OK }],
    ["argument over environment", URL_OK, { THINGS_MCP_URL: "https://other.example/mcp/things" }],
    ["surrounding whitespace", ` ${URL_OK}\n`, {}],
  ])("takes the URL from the %s", (_name, argument, env) => {
    expect(resolveUrl(argument, env)).toBe(URL_OK);
  });

  test.each<[string, string | undefined, string]>([
    ["nothing to read", undefined, "Pass the server URL"],
    ["an empty environment value", "", "Pass the server URL"],
    ["a bare word", "tailgate", "Not a URL"],
    ["http", "http://node.example.ts.net/mcp/things", "Funnel serves https"],
    ["a query", `${URL_OK}?scope=all`, "changes the audience"],
    ["a fragment", `${URL_OK}#tools`, "changes the audience"],
    ["an origin alone", "https://node.example.ts.net", "Name the upstream path"],
    ["a trailing slash", `${URL_OK}/`, "Drop the trailing slash"],
  ])("rejects %s", (_name, argument, message) => {
    expect(() => resolveUrl(argument, {})).toThrow(message);
  });
});

describe("parseConfiguredUrl", () => {
  test("reads the URL line out of a configured server", () => {
    expect(
      parseConfiguredUrl(
        [
          `${SERVER_NAME}:`,
          "  Scope: User config (available in all your projects)",
          "  Status: ! Needs authentication",
          "  Type: http",
          `  URL: ${URL_OK}`,
        ].join("\n"),
      ),
    ).toBe(URL_OK);
  });

  test("returns nothing when no URL line is present", () => {
    expect(parseConfiguredUrl(`${SERVER_NAME}:\n  Type: stdio\n`)).toBeUndefined();
  });
});

function recorder(existing: string | undefined): ClaudeActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get() {
      calls.push("get");
      return Promise.resolve(existing);
    },
    add(_name, url) {
      calls.push(`add ${url}`);
      return Promise.resolve();
    },
    login() {
      calls.push("login");
      return Promise.resolve();
    },
  };
}

describe("setup", () => {
  test("configures a server that is not there yet", async () => {
    const actions = recorder(undefined);
    expect(await setup(URL_OK, actions)).toEqual({ configured: "added", url: URL_OK });
    expect(actions.calls).toEqual(["get", `add ${URL_OK}`, "login"]);
  });

  test("logs in again without reconfiguring a matching entry", async () => {
    const actions = recorder(URL_OK);
    expect(await setup(URL_OK, actions)).toEqual({ configured: "unchanged", url: URL_OK });
    expect(actions.calls).toEqual(["get", "login"]);
  });

  test("refuses to repoint an entry that names another URL", async () => {
    const actions = recorder("https://other.example/mcp/things");
    const failure = await setup(URL_OK, actions).catch((error: unknown) => error);
    expect(String(failure)).toContain("claude mcp remove things -s user");
    expect(actions.calls).toEqual(["get"]);
  });
});
