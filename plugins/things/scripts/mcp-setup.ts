#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: claude mcp login opens a browser through Launch Services, which the command sandbox blocks

import { cli } from "cleye";

export const SERVER_NAME = "things";

/** Reads the configured URL out of `claude mcp get`'s output. */
export function parseConfiguredUrl(output: string): string | undefined {
  return /^\s*URL:\s*(\S+)\s*$/m.exec(output)?.[1];
}

/**
 * Takes the server URL from an argument or `THINGS_MCP_URL`, so the tailnet
 * hostname never lands in the repo.
 *
 * tailgate compares a token's audience as an exact string against the
 * upstream's canonical resource URI, so a URL that differs by a trailing slash
 * authenticates and then fails every call. Rejecting one here is cheaper than
 * reading that failure off a 403.
 */
export function resolveUrl(
  argument: string | undefined,
  env: Record<string, string | undefined>,
): string {
  const url = (argument ?? env.THINGS_MCP_URL ?? "").trim();
  if (url === "") {
    throw new Error("Pass the server URL as an argument or set THINGS_MCP_URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Funnel serves https, so ${url} cannot be the upstream`);
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`A query or fragment changes the audience string: ${url}`);
  }
  if (parsed.pathname === "/") {
    throw new Error(`Name the upstream path, as in ${parsed.origin}/mcp/${SERVER_NAME}`);
  }
  if (parsed.pathname.endsWith("/")) {
    throw new Error(`Drop the trailing slash: the audience is compared byte for byte`);
  }

  return url;
}

/** How {@link setup} reaches the Claude Code CLI, injectable so a test can drive it without one. */
export interface ClaudeActions {
  get(name: string): Promise<string | undefined>;
  add(name: string, url: string): Promise<void>;
  login(name: string): Promise<void>;
}

export interface SetupResult {
  configured: "added" | "unchanged";
  url: string;
}

/**
 * Configures the server at user scope and logs in.
 *
 * Re-running against the same URL logs in without touching the entry, which is
 * what a tailgate restart calls for: it drops every issued token and leaves the
 * configuration alone.
 */
export async function setup(url: string, actions: ClaudeActions): Promise<SetupResult> {
  const existing = await actions.get(SERVER_NAME);

  if (existing !== undefined && existing !== url) {
    throw new Error(
      `${SERVER_NAME} points at ${existing}. Run \`claude mcp remove ${SERVER_NAME} -s user\` before configuring ${url}`,
    );
  }

  if (existing === undefined) {
    await actions.add(SERVER_NAME, url);
  }

  await actions.login(SERVER_NAME);

  return { configured: existing === undefined ? "added" : "unchanged", url };
}

async function run(args: string[], capture: boolean): Promise<{ code: number; output: string }> {
  const child = Bun.spawn(["claude", ...args], {
    stdin: capture ? "ignore" : "inherit",
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  });
  const output = capture ? await new Response(child.stdout).text() : "";
  return { code: await child.exited, output };
}

export const claudeCli: ClaudeActions = {
  async get(name) {
    const { code, output } = await run(["mcp", "get", name], true);
    return code === 0 ? parseConfiguredUrl(output) : undefined;
  },
  async add(name, url) {
    const { code } = await run(
      ["mcp", "add", "--scope", "user", "--transport", "http", name, url],
      false,
    );
    if (code !== 0) {
      throw new Error(`claude mcp add exited ${code}`);
    }
  },
  async login(name) {
    const { code } = await run(["mcp", "login", name], false);
    if (code !== 0) {
      throw new Error(`claude mcp login exited ${code}`);
    }
  },
};

if (import.meta.main) {
  const argv = cli({
    name: "mcp-setup",
    parameters: ["[url]"],
    help: {
      description: `Configure the ${SERVER_NAME} MCP server at user scope and log in. Takes the URL from the argument or THINGS_MCP_URL.`,
    },
  });

  try {
    const result = await setup(resolveUrl(argv._.url, process.env), claudeCli);
    console.log(
      result.configured === "added"
        ? `configured ${SERVER_NAME} at ${result.url}`
        : `${SERVER_NAME} already points at ${result.url}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
