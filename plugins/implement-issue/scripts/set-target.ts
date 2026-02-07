#!/usr/bin/env bun

import { parseIssueUrl, writeTarget } from "./target";

const sessionId = process.env.CLAUDE_SESSION_ID;
if (!sessionId) {
  console.error("CLAUDE_SESSION_ID is not set");
  process.exit(1);
}

const url = process.argv[2];
if (!url) {
  console.error("Usage: set-target.ts <issue-url>");
  process.exit(1);
}

const target = parseIssueUrl(url);
if (!target) {
  console.error(`Unrecognized issue URL: ${url}`);
  process.exit(1);
}

writeTarget(sessionId, target);
