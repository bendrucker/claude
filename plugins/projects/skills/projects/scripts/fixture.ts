import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectsDir } from "./projects";
import { appendDispatch, type DispatchLedgerRow } from "./threads";

export const NOW = new Date("2026-09-18T12:00:00.000Z");

export const row = (overrides: Partial<DispatchLedgerRow>): DispatchLedgerRow => ({
  ts: "2026-09-18T09:00:00.000Z",
  task: "fix the thing",
  repo: "/repo",
  branch: "fix-thing",
  path: "/worktrees/repo/fix-thing",
  workspace: "wZZ",
  pane: "wZZ:p1",
  agent: "fix-thing",
  session: "sess-1",
  outcome: "dispatched",
  ...overrides,
});

export const PROJECT = `---
name: Ledger routing
description: Dispatch ledger, project routing, and the chief and lead sessions that read it
repo: /repo
tracker: https://example.test/projects/ledger
---

Standing instructions for every thread.
`;

// A ledger with one finished thread, one blocked thread, one open one-off, and
// one orphan, beside one readable project and one that fails to parse.
export async function fixture(): Promise<string> {
  const dataDir = mkdtempSync(join(tmpdir(), "ledger-"));
  const rows = [
    row({ branch: "done-thing", tags: { project: "ledger", by: "lead-ledger" } }),
    row({ branch: "fix-thing", tags: { project: "ledger", by: "lead-ledger" } }),
    row({ branch: "one-off", agent: "one-off", pane: "wA:p1", tags: { by: "chief" } }),
    row({ branch: "lost", agent: null, outcome: "orphaned" }),
    row({
      ts: "2026-09-18T10:00:00.000Z",
      branch: "done-thing",
      outcome: "done",
      pr: "https://example.test/pr/1",
      tags: { project: "ledger", by: "lead-ledger" },
    }),
    row({
      ts: "2026-09-18T11:30:00.000Z",
      branch: "fix-thing",
      outcome: "blocked",
      note: "needs a decision",
      tags: { project: "ledger", by: "lead-ledger" },
    }),
  ];
  for (const entry of rows) appendDispatch(entry, dataDir);
  mkdirSync(join(projectsDir(dataDir), "ledger"), { recursive: true });
  mkdirSync(join(projectsDir(dataDir), "broken"), { recursive: true });
  await Bun.write(join(projectsDir(dataDir), "ledger", "project.md"), PROJECT);
  await Bun.write(join(projectsDir(dataDir), "broken", "project.md"), "no frontmatter here\n");
  return dataDir;
}
