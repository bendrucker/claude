export interface MrRef {
  /** Host with port when present, e.g. `gitlab.com` or `git.corp:8443`. */
  host: string;
  /** Full project path with every group, e.g. `group/sub/project`. */
  projectPath: string;
  iid: number;
  /** `${scheme}://${host}/${projectPath}/-/merge_requests/${iid}`, ending at the iid. */
  url: string;
  /** `${host}/${projectPath}!${iid}` */
  key: string;
}

export type MrCommand =
  | { kind: "toggle" }
  | { kind: "track"; ref: MrRef }
  | { kind: "untrack"; ref: MrRef }
  | { kind: "untrack"; iid: number }
  | { kind: "invalid"; reason: string };

// scheme, host[:port], at least two path segments (group + project), then `/-/merge_requests/<n>`.
const MR_URL =
  /(https?):\/\/([^\s/?#]+)\/((?:[^\s/?#]+\/)+[^\s/?#]+)\/-\/merge_requests\/(\d+)(?!\w)/g;

const USAGE = "usage: /mr [track <url> | untrack <url|!iid>]";

function refOf(match: RegExpExecArray): MrRef {
  const [, scheme, host, projectPath, iid] = match;
  if (
    scheme === undefined ||
    host === undefined ||
    projectPath === undefined ||
    iid === undefined
  ) {
    throw new Error("MR_URL matched without its groups");
  }
  return {
    host,
    projectPath,
    iid: Number(iid),
    url: `${scheme}://${host}/${projectPath}/-/merge_requests/${iid}`,
    key: `${host}/${projectPath}!${iid}`,
  };
}

function refsIn(text: string): MrRef[] {
  return Array.from(text.matchAll(MR_URL), (m) => refOf(m));
}

export function parseMrUrl(text: string): MrRef | undefined {
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

function gitSubcommand(tokens: string[]): string | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) break;
    if (token === "-C" || token === "-c") i++;
    else if (!token.startsWith("-")) return token;
  }
  return undefined;
}

function isGlabCreate(tokens: string[]): boolean {
  return tokens[1] === "mr" && (tokens[2] === "create" || tokens[2] === "new");
}

function viewedRefs(output: string): MrRef[] {
  const lines = output.split("\n").map((line) => line.replace(/^\s*remote:\s*/, ""));
  const refs: MrRef[] = [];
  for (const [i, line] of lines.entries()) {
    if (!/View merge request for\b/.test(line)) continue;
    for (const next of lines.slice(i + 1)) {
      if (next.trim() === "") {
        if (refs.length > 0) break;
        continue;
      }
      const found = refsIn(next);
      if (found.length === 0) break;
      refs.push(...found);
    }
  }
  return refs;
}

export function mrUrlsOf(command: string, output: string): MrRef[] {
  const refs: MrRef[] = [];
  let created = false;
  let pushed = false;
  for (const raw of segmentsOf(command)) {
    const tokens = withoutAssignments(raw);
    if (tokens[0] === "glab" && isGlabCreate(tokens)) created = true;
    if (tokens[0] === "git" && gitSubcommand(tokens) === "push") pushed = true;
  }
  if (created) refs.push(...refsIn(output));
  if (pushed) refs.push(...viewedRefs(output));

  const seen = new Set<string>();
  return refs.filter((ref) => !seen.has(ref.key) && seen.add(ref.key));
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

export function parseMrCommand(args: string): MrCommand {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { kind: "toggle" };
  const [subcommand, ...rest] = tokens;
  if (subcommand !== "track" && subcommand !== "untrack") return { kind: "invalid", reason: USAGE };
  if (rest.length !== 1) return { kind: "invalid", reason: USAGE };
  const arg = rest[0];
  if (arg === undefined) return { kind: "invalid", reason: USAGE };
  const ref = parseMrUrl(arg);
  if (subcommand === "track") {
    return ref
      ? { kind: "track", ref }
      : { kind: "invalid", reason: `not a merge request URL: ${arg}` };
  }
  if (ref) return { kind: "untrack", ref };
  const iid = /^!?(\d+)$/.exec(arg);
  const n = Number(iid?.[1]);
  if (n > 0) return { kind: "untrack", iid: n };
  return { kind: "invalid", reason: `not a merge request URL or !iid: ${arg}` };
}
