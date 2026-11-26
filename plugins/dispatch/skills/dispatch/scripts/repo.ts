import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { CommandResult, Runner, RunOptions } from "./dispatch";

const NAME = "[A-Za-z0-9._-]+?";
const OWNER = "[A-Za-z0-9-]+";
const SLUG = new RegExp(`^(${OWNER})/(${NAME})(?:\\.git)?$`);
// An HTTPS, ssh://, or scp-style GitHub remote URL.
const GITHUB_URL = new RegExp(
  `^(?:https://github\\.com/|ssh://git@github\\.com/|git@github\\.com:)(${OWNER})/(${NAME})(?:\\.git)?/?$`,
);
const PUSH_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);
const CLONE_TIMEOUT_MS = 600_000;
// GitHub over SSH waits on a key nobody is there to touch. The git that gh
// runs clones and fetches over HTTPS, and the remotes keep the URLs gh writes.
const HTTPS_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
  GIT_CONFIG_VALUE_0: "git@github.com:",
  GIT_CONFIG_KEY_1: "url.https://github.com/.insteadOf",
  GIT_CONFIG_VALUE_1: "ssh://git@github.com/",
};

export interface Slug {
  owner: string;
  name: string;
}

const Owned = z.object({ name: z.string(), owner: z.object({ login: z.string() }) });
const GhRepo = Owned.extend({
  parent: Owned.nullable(),
  viewerPermission: z.string().nullable(),
  defaultBranchRef: z.object({ name: z.string() }).nullable(),
});

async function exists(path: string): Promise<boolean> {
  return realpath(path).then(
    () => true,
    () => false,
  );
}

function failure(result: CommandResult, label: string): string {
  const stderr = result.stderr.trim();
  return stderr === "" ? `${label} exited ${result.code}` : stderr;
}

export type RepoSpec = { kind: "path"; path: string } | { kind: "slug"; slug: Slug };

function slugOf(match: RegExpExecArray | null): Slug | null {
  const [, owner, name] = match ?? [];
  return owner == null || name == null ? null : { owner, name };
}

// A relative owner/name directory that exists stays a path.
export async function parseRepoSpec(spec: string, home: string): Promise<RepoSpec> {
  const url = slugOf(GITHUB_URL.exec(spec));
  if (url != null) return { kind: "slug", slug: url };
  if (await exists(spec)) return { kind: "path", path: spec };
  const slug = slugOf(SLUG.exec(spec));
  if (slug != null) return { kind: "slug", slug };
  const parts = relative(join(home, "src"), resolve(spec)).split(sep);
  const [owner, name] = parts;
  if (parts.length === 2 && owner != null && name != null && !owner.startsWith(".."))
    return { kind: "slug", slug: { owner, name } };
  throw new Error(
    `${spec} does not exist. Pass an owner/name slug, a GitHub URL, or a path under ${join(home, "src")}/<owner>/<name> to clone it.`,
  );
}

export function checkoutPath(home: string, slug: Slug): string {
  return join(home, "src", slug.owner, slug.name);
}

async function gh(run: Runner, argv: readonly string[], cwd?: string): Promise<string> {
  const options: RunOptions = { timeoutMs: CLONE_TIMEOUT_MS, env: HTTPS_GIT_ENV };
  if (cwd != null) options.cwd = cwd;
  const result = await run(["gh", ...argv], options);
  if (result.code !== 0) throw new Error(failure(result, `gh ${argv.slice(0, 2).join(" ")}`));
  return result.stdout;
}

async function view(run: Runner, slug: Slug): Promise<z.infer<typeof GhRepo>> {
  const stdout = await gh(run, [
    "repo",
    "view",
    `${slug.owner}/${slug.name}`,
    "--json",
    "name,owner,parent,viewerPermission,defaultBranchRef",
  ]);
  return GhRepo.parse(JSON.parse(stdout));
}

// The checkout goes in the upstream owner's directory. Without push access,
// origin is the viewer's fork and upstream is the parent.
export async function cloneRepo(run: Runner, slug: Slug, home: string): Promise<string> {
  const named = await view(run, slug);
  const upstream =
    named.parent == null
      ? named
      : await view(run, { owner: named.parent.owner.login, name: named.parent.name });
  const upstreamSlug = `${upstream.owner.login}/${upstream.name}`;
  const path = checkoutPath(home, { owner: upstream.owner.login, name: upstream.name });
  if (await exists(path)) return path;

  await mkdir(dirname(path), { recursive: true });
  if (PUSH_PERMISSIONS.has(upstream.viewerPermission ?? "")) {
    await gh(run, ["repo", "clone", upstreamSlug, path]);
    return path;
  }
  await gh(run, ["repo", "fork", upstreamSlug, "--clone", "--", path], dirname(path));
  const branch = upstream.defaultBranchRef?.name;
  if (branch != null) {
    const head = await run(["git", "-C", path, "remote", "set-head", "upstream", branch]);
    if (head.code !== 0) throw new Error(failure(head, "git remote set-head"));
  }
  return path;
}

export type ResolveRepo = (spec: string, run: Runner) => Promise<string>;

export const resolveRepo = async (
  spec: string,
  run: Runner,
  home: string = homedir(),
): Promise<string> => {
  const parsed = await parseRepoSpec(spec, home);
  if (parsed.kind === "path") return parsed.path;
  return cloneRepo(run, parsed.slug, home);
};
