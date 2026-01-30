#!/usr/bin/env bun
// Detect git hosting provider from remote URL
// Outputs: github, gitlab, or unknown

import { execSync } from "node:child_process";

export type Provider = "github" | "gitlab" | "unknown";

export function detectProvider(cwd?: string): Provider {
  let remoteUrl: string;
  try {
    remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Expected: no remote configured or not a git repository
    if (message.includes("No such remote") || message.includes("not a git repository")) {
      return "unknown";
    }
    // Unexpected: log for debugging
    console.error(`[pull-request/detect-provider] ${message}`);
    return "unknown";
  }

  // Extract host from URL (handles ssh and https formats)
  // ssh: git@github.com:user/repo.git
  // https: https://github.com/user/repo.git
  const host = remoteUrl.replace(/^(git@|https?:\/\/)/, "").replace(/[:/].*/, "");

  if (host === "github.com") {
    return "github";
  }

  // gitlab.com, gitlab.*, *.gitlab.*
  if (host === "gitlab.com" || /^gitlab\./.test(host) || /\.gitlab\./.test(host)) {
    return "gitlab";
  }

  return "unknown";
}

// Run as CLI
if (import.meta.main) {
  console.log(detectProvider());
}
