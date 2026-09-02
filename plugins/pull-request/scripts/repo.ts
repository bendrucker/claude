// What the hook learns about the repository behind the command: whether the
// authenticated user owns it, and whether a hex run names one of its commits.

import { homedir } from "node:os";
import { join } from "node:path";
import type { RepoContext } from "./body-rules";

const SSH_REMOTE = /^[\w.+-]+@([\w.-]+):(.+)$/;
const URL_REMOTE = /^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i;

export interface ParsedRemote {
  host: string;
  owner: string;
}

export function parseRemote(remoteUrl: string): ParsedRemote | null {
  const trimmed = remoteUrl.trim();
  const match = trimmed.match(SSH_REMOTE) ?? trimmed.match(URL_REMOTE);
  const host = match?.[1];
  const path = match?.[2];
  if (host === undefined || path === undefined) return null;
  const owner = path.replace(/^\/+/, "").split("/")[0];
  if (owner === undefined || owner.length === 0) return null;
  return { host: host.toLowerCase(), owner };
}

// `hosts.yml` is two levels deep (host, then per-host keys), so a line-oriented
// read is enough and keeps a YAML parser out of the hook's startup path.
export function parseGhLogin(hostsYaml: string): string | null {
  let inGitHub = false;
  for (const line of hostsYaml.split("\n")) {
    if (/^\S/.test(line)) {
      inGitHub = line.trim().replace(/:$/, "") === "github.com";
      continue;
    }
    if (!inGitHub) continue;
    const user = line.match(/^\s+user:\s*(.+?)\s*$/)?.[1];
    if (user != null && user !== "") return user.replace(/^["']|["']$/g, "");
  }
  return null;
}

async function readGitRemote(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const url = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? url.trim() : null;
  } catch {
    return null;
  }
}

async function readGhHosts(): Promise<string | null> {
  try {
    return await Bun.file(join(homedir(), ".config", "gh", "hosts.yml")).text();
  } catch {
    return null;
  }
}

// The login comes from `hosts.yml`'s github.com entry, so the owner comparison
// only means anything on a github.com remote. A GitLab or GHES remote whose
// namespace happens to match the github.com handle is someone else's repo.
export function isPersonalRepo(remote: string | null, hostsYaml: string | null): boolean {
  if (remote === null || hostsYaml === null) return false;
  const parsed = parseRemote(remote);
  const login = parseGhLogin(hostsYaml);
  if (parsed === null || login === null) return false;
  return parsed.host === "github.com" && parsed.owner.toLowerCase() === login.toLowerCase();
}

async function commitExists(cwd: string, sha: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", `${sha}^{commit}`], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

export function gitRepo(cwd: string): RepoContext {
  return {
    personalRepo: async () => {
      const [remote, hosts] = await Promise.all([readGitRemote(cwd), readGhHosts()]);
      return isPersonalRepo(remote, hosts);
    },
    hasCommit: (sha) => commitExists(cwd, sha),
  };
}
