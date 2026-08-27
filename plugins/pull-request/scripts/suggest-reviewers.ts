#!/usr/bin/env bun
// Suggest PR/MR reviewers from the git history of the changed files, as JSON.
// Provider-agnostic: emits git identities and recent in-area PR/MR refs.
// Username resolution and actually requesting reviews stay in the skill.

import { execSync } from "node:child_process";

function git(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

export interface Owner {
  name: string;
  email: string;
  /** Surviving blamed lines across the changed files. */
  lines: number;
}

export interface Suggestion {
  /** Blame owners of the changed files, ranked by lines owned, you excluded. */
  owners: Owner[];
  /** True when you're the only author of the area: fall back to areaRefs. */
  soleAuthor: boolean;
  /** Recent PR/MR refs (#123, !45) from commits touching these files. */
  areaRefs: string[];
}

/** Your own git identities, lowercased, to exclude from suggestions. */
export function selfIdentities(cwd?: string): Set<string> {
  const ids = ["user.email", "user.name"].map((key) => git(`config ${key}`, cwd).toLowerCase());
  return new Set(ids.filter(Boolean));
}

/** The base ref to diff against (the default branch). */
function baseRef(cwd?: string, override?: string): string | null {
  if (override) return override;
  const head = git("symbolic-ref --quiet refs/remotes/origin/HEAD", cwd);
  if (head) return head.replace(/^refs\/remotes\//, "");
  return (
    ["origin/main", "origin/master", "main", "master"].find((ref) =>
      git(`rev-parse --verify --quiet ${ref}`, cwd),
    ) ?? null
  );
}

/** Files you changed on the branch plus working-tree edits, deletions dropped. */
export function changedFiles(cwd?: string, base?: string): string[] {
  const ref = baseRef(cwd, base);
  const commands = [
    ref && `diff --name-only --diff-filter=d ${ref}...HEAD`,
    "diff --name-only --diff-filter=d HEAD",
  ];
  const files = commands.flatMap((c) => (c ? git(c, cwd).split("\n") : [])).filter(Boolean);
  return [...new Set(files)];
}

/** Tally blame line ownership across the changed files, excluding your own identities. */
export function blameOwners(files: string[], self: Set<string>, cwd?: string): Owner[] {
  const byEmail = new Map<string, Owner>();
  for (const file of files) {
    let name = "";
    for (const line of git(`blame --line-porcelain HEAD -- "${file}"`, cwd).split("\n")) {
      if (line.startsWith("author ")) {
        name = line.slice("author ".length).trim();
      } else if (line.startsWith("author-mail ")) {
        const email = line.slice("author-mail ".length).trim().replace(/^<|>$/g, "");
        const key = email.toLowerCase();
        if (self.has(key) || self.has(name.toLowerCase())) continue;
        const owner = byEmail.get(key) ?? { name, email, lines: 0 };
        owner.lines += 1;
        byEmail.set(key, owner);
      }
    }
  }
  return [...byEmail.values()].toSorted((a, b) => b.lines - a.lines);
}

/** PR/MR refs parsed from recent commits touching the changed files on the base branch. */
export function areaRefs(files: string[], cwd?: string, base?: string): string[] {
  if (files.length === 0) return [];
  const quoted = files.map((f) => `"${f}"`).join(" ");
  const log = git(`log ${baseRef(cwd, base) ?? "HEAD"} -n 40 --format=%s%n%b -- ${quoted}`, cwd);
  const refs = [...log.matchAll(/[#!]\d+/g)].map((m) => m[0]);
  return [...new Set(refs)].slice(0, 5);
}

export function suggestReviewers(cwd?: string, base?: string): Suggestion {
  const files = changedFiles(cwd, base);
  const owners = blameOwners(files, selfIdentities(cwd), cwd);
  return { owners, soleAuthor: owners.length === 0, areaRefs: areaRefs(files, cwd, base) };
}

if (import.meta.main) {
  console.log(JSON.stringify(suggestReviewers(), null, 2));
}
