export type Origin = "branch" | "created" | "stacked" | "manual";

export interface PrRef {
  /** Host with port when present, e.g. `github.com` or `ghe.corp:8443`. */
  host: string;
  owner: string;
  repo: string;
  pr: number;
  /** `${scheme}://${host}/${owner}/${repo}/pull/${pr}`, ending at the number. */
  url: string;
  /** `${host}/${owner}/${repo}#${pr}` */
  key: string;
}

export type PrCommand =
  | { kind: "toggle" }
  | { kind: "track"; ref: PrRef }
  | { kind: "untrack"; ref: PrRef }
  | { kind: "untrack"; pr: number }
  | { kind: "invalid"; reason: string };

const PR_URL = /(https?):\/\/([^\s/?#]+)\/([^\s/?#]+)\/([^\s/?#]+)\/pull\/(\d+)(?!\w)/g;

const USAGE = "usage: /pr [track <url> | untrack <url|#n>]";

function refOf(match: RegExpExecArray): PrRef {
  const [, scheme, host, owner, repo, pr] = match;
  if (
    scheme === undefined ||
    host === undefined ||
    owner === undefined ||
    repo === undefined ||
    pr === undefined
  ) {
    throw new Error("PR_URL matched without its groups");
  }
  return {
    host,
    owner,
    repo,
    pr: Number(pr),
    url: `${scheme}://${host}/${owner}/${repo}/pull/${pr}`,
    key: `${host}/${owner}/${repo}#${pr}`,
  };
}

function refsIn(text: string): PrRef[] {
  return Array.from(text.matchAll(PR_URL), (m) => refOf(m));
}

export function parsePrUrl(text: string): PrRef | undefined {
  return refsIn(text)[0];
}

function segmentsOf(command: string): string[][] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

function withoutAssignments(tokens: string[]): string[] {
  const start = tokens.findIndex((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  return start === -1 ? [] : tokens.slice(start);
}

function originOf(tokens: string[]): "created" | "stacked" | undefined {
  if (tokens[0] !== "gh") return undefined;
  if (tokens[1] === "pr" && tokens[2] === "create") return "created";
  if (
    tokens[1] === "stack" &&
    (tokens[2] === "link" || tokens[2] === "submit" || tokens[2] === "push")
  ) {
    return "stacked";
  }
  return undefined;
}

export function prUrlsOf(
  command: string,
  output: string,
): { ref: PrRef; origin: "created" | "stacked" }[] {
  const origins = new Set<"created" | "stacked">();
  for (const raw of segmentsOf(command)) {
    const origin = originOf(withoutAssignments(raw));
    if (origin) origins.add(origin);
  }
  if (origins.size === 0) return [];
  const origin = origins.has("created") ? "created" : "stacked";

  const seen = new Set<string>();
  return refsIn(output)
    .filter((ref) => !seen.has(ref.key) && seen.add(ref.key))
    .map((ref) => ({ ref, origin }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function bashOf(event: unknown): { command: string; output: string } | undefined {
  if (!isRecord(event) || event.tool_name !== "Bash") return undefined;
  const { tool_input: input, tool_response: response } = event;
  if (!isRecord(input) || typeof input.command !== "string") return undefined;
  const command = input.command;
  if (typeof response === "string") return { command, output: response };
  if (!isRecord(response)) return undefined;
  const parts = [response.stdout, response.stderr].filter(
    (p): p is string => typeof p === "string",
  );
  return { command, output: parts.join("\n") };
}

export function parsePrCommand(args: string): PrCommand {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { kind: "toggle" };
  const [subcommand, ...rest] = tokens;
  if (subcommand !== "track" && subcommand !== "untrack") return { kind: "invalid", reason: USAGE };
  if (rest.length !== 1) return { kind: "invalid", reason: USAGE };
  const arg = rest[0];
  if (arg === undefined) return { kind: "invalid", reason: USAGE };
  const ref = parsePrUrl(arg);
  if (subcommand === "track") {
    return ref
      ? { kind: "track", ref }
      : { kind: "invalid", reason: `not a pull request URL: ${arg}` };
  }
  if (ref) return { kind: "untrack", ref };
  const n = Number(/^#?(\d+)$/.exec(arg)?.[1]);
  if (n > 0) return { kind: "untrack", pr: n };
  return { kind: "invalid", reason: `not a pull request URL or #n: ${arg}` };
}
