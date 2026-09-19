#!/usr/bin/env bun
// Plugin agents cannot carry frontmatter hooks, so chief's post-compaction
// reprint of the ledger lives here and keys on the session's agent.

import { dirname, join } from "node:path";
import { z } from "zod";

const CHIEF = "projects:chief";

const SessionStartInput = z.object({
  agent_type: z.string().optional(),
  source: z.string().optional(),
});

const input = SessionStartInput.parse(JSON.parse(await Bun.stdin.text()));

if (input.agent_type === CHIEF && input.source === "compact") {
  const ledger = join(dirname(import.meta.dir), "skills", "projects", "scripts", "ledger.ts");
  const result = Bun.spawnSync(["bun", ledger, "status"], { stdout: "pipe", stderr: "pipe" });
  process.stdout.write(result.stdout.toString());
  process.stderr.write(result.stderr.toString());
}
