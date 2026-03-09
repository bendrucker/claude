#!/usr/bin/env bun
// Detect and output PR/MR template content from the repository
// Outputs: template content if found, nothing otherwise

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectProvider, type Provider } from "./detect-provider";

const GITHUB_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "docs/pull_request_template.md",
];

const GITLAB_PATHS = [
  ".gitlab/merge_request_templates/Default.md",
  ".gitlab/merge_request_templates/default.md",
];

export function findTemplate(provider: Provider, repoRoot: string): string | null {
  const paths = provider === "github" ? GITHUB_PATHS : provider === "gitlab" ? GITLAB_PATHS : [];
  for (const p of paths) {
    const full = join(repoRoot, p);
    if (existsSync(full)) {
      return readFileSync(full, "utf-8");
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
  const provider = detectProvider();
  const template = findTemplate(provider, repoRoot);
  if (template) {
    process.stdout.write(template);
  }
}
