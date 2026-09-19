import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agents, PullRequest } from "./capture";
import { projectsDir } from "./projects";
import type { Observed } from "./status";
import { appendDispatch, type DispatchLedgerRow } from "./threads";

export const NOW = new Date("2026-09-18T12:00:00.000Z");
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export const ago = (base: Date, ms: number): string => new Date(base.getTime() - ms).toISOString();

type Listing = [pane: string, name: string | null, status: string, session?: string];

export const agents = (...entries: readonly Listing[]): Agents => ({
  names: new Set(entries.flatMap(([, name]) => (name == null ? [] : [name]))),
  panes: new Map(entries.map(([pane, name, status]) => [pane, { name, status }])),
  sessions: new Map(
    entries.flatMap(([, name, status, session]) =>
      session == null ? [] : [[session, { name, status }] as const],
    ),
  ),
});

export const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  state: "open",
  approved: false,
  draft: false,
  ...overrides,
});

export const observe = (overrides: Partial<Observed> = {}): Observed => ({
  agents: null,
  pullRequests: new Map(),
  now: NOW,
  ...overrides,
});

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
// one orphan, beside one readable project and one that fails to parse. The ages
// are relative so the CLI tests, which run against the real clock, stay inside
// the window a pull request lookup covers.
export async function fixture(now: Date = NOW): Promise<string> {
  const dataDir = mkdtempSync(join(tmpdir(), "ledger-"));
  const dispatched = ago(now, 3 * 60 * MINUTE);
  const rows = [
    row({ ts: dispatched, branch: "done-thing", tags: { project: "ledger", by: "lead-ledger" } }),
    row({ ts: dispatched, branch: "fix-thing", tags: { project: "ledger", by: "lead-ledger" } }),
    row({
      ts: dispatched,
      branch: "one-off",
      agent: "one-off",
      pane: "wA:p1",
      tags: { by: "chief" },
    }),
    row({ ts: dispatched, branch: "lost", agent: null, outcome: "orphaned" }),
    row({
      ts: ago(now, 2 * 60 * MINUTE),
      branch: "done-thing",
      outcome: "done",
      pr: "https://example.test/pr/1",
      tags: { project: "ledger", by: "lead-ledger" },
    }),
    row({
      ts: ago(now, 30 * MINUTE),
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
