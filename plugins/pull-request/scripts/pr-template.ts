#!/usr/bin/env bun

import { execSync } from "node:child_process";
import { join } from "node:path";
import { markdown } from "bun";
import { z } from "zod";

export const Provider = z.enum(["github", "gitlab"]);
export type Provider = z.infer<typeof Provider>;

const TEMPLATE_PATHS: Record<Provider, string[]> = {
  github: [
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/pull_request_template.md",
    "PULL_REQUEST_TEMPLATE.md",
    "pull_request_template.md",
    "docs/pull_request_template.md",
  ],
  gitlab: [
    ".gitlab/merge_request_templates/Default.md",
    ".gitlab/merge_request_templates/default.md",
  ],
};

export async function findTemplate(provider: Provider, repoRoot: string): Promise<string | null> {
  const paths = TEMPLATE_PATHS[provider] ?? [];
  for (const p of paths) {
    const full = join(repoRoot, p);
    const file = Bun.file(full);
    if (await file.exists()) {
      return await file.text();
    }
  }
  return null;
}

function getRepoRoot(): string {
  return execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

if (import.meta.main) {
  const repoRoot = getRepoRoot();
  const provider = Provider.safeParse(process.argv[2]).data ?? "github";
  const template = await findTemplate(provider, repoRoot);
  if (template) {
    process.stdout.write(markdown.ansi(template));
  }
}
