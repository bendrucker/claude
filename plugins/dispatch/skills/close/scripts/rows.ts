import { type ClosedRow, isClosedRow, readLedger } from "../../dispatch/scripts/ledger";
import type { GitFacts } from "./git";
import type { Pane } from "./muxer";

export type Outcome = NonNullable<ClosedRow["outcome"]>;

interface RowFields {
  ts: string;
  session: string;
  fork: string | null;
  pr: string | null;
  summary: string | null;
}

function base(facts: GitFacts, fields: RowFields) {
  return {
    ...fields,
    branch: facts.branch,
    path: facts.toplevel,
    head: facts.head,
    dirty: facts.dirty,
    ahead: facts.ahead,
  };
}

export function closedRow(facts: GitFacts, fields: RowFields, pane: Pane): ClosedRow {
  return { event: "closed", ...base(facts, fields), mux: pane.mux, target: pane.target };
}

export function endedRow(facts: GitFacts, fields: RowFields, outcome: Outcome): ClosedRow {
  return { event: "ended", ...base(facts, fields), mux: null, target: null, outcome };
}

export function leftBehind(rows: readonly ClosedRow[]): ClosedRow[] {
  const latest = new Map<string, ClosedRow>();
  for (const row of rows) {
    const key = row.path ?? row.branch ?? row.ts;
    latest.delete(key);
    latest.set(key, row);
  }
  return [...latest.values()].filter((row) => (row.dirty ?? 0) > 0 || (row.ahead ?? 0) > 0);
}

export function closedRows(dataDir: string, onlyLeftBehind: boolean): ClosedRow[] {
  const rows = readLedger(dataDir).filter(isClosedRow);
  return onlyLeftBehind ? leftBehind(rows) : rows;
}
