#!/usr/bin/env bun

import { cli } from "cleye";
import { parseIssueUrl, writeTarget } from "./target";

const argv = cli({
  name: "set-target",
  parameters: ["<url>"],
  flags: {
    sessionId: {
      type: String,
      description: "Claude session ID",
      alias: "s",
    },
  },
});

if (!argv.flags.sessionId) {
  console.error("--session-id is required");
  process.exit(1);
}

const target = parseIssueUrl(argv._.url);
if (!target) {
  console.error(`Unrecognized issue URL: ${argv._.url}`);
  process.exit(1);
}

writeTarget(argv.flags.sessionId, target);
