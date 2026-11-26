import { z } from "zod";

export const Status = z.enum(["open", "fixed", "exempt", "proposed"]);

export const Row = z.object({
  fingerprint: z.string(),
  checkpoint: z.string(),
  status: Status,
  count: z.number(),
  example: z.string(),
  old: z.string(),
  new: z.string(),
  note: z.string().default(""),
});
export type Row = z.infer<typeof Row>;

export const Ledger = z.object({ rows: z.array(Row) });
export type Ledger = z.infer<typeof Ledger>;

export interface Observation {
  fingerprint: string;
  checkpoint: string;
  input: string;
  old: string;
  new: string;
}

export function merge(previous: Ledger, observations: Observation[]): Ledger {
  const seen = new Map<string, Row>();
  for (const o of observations) {
    const row = seen.get(o.fingerprint);
    if (row) row.count++;
    else
      seen.set(o.fingerprint, {
        fingerprint: o.fingerprint,
        checkpoint: o.checkpoint,
        status: "open",
        count: 1,
        example: o.input,
        old: o.old,
        new: o.new,
        note: "",
      });
  }
  const rows: Row[] = [];
  for (const before of previous.rows) {
    const now = seen.get(before.fingerprint);
    seen.delete(before.fingerprint);
    if (now)
      rows.push({
        ...now,
        status: before.status === "fixed" ? "open" : before.status,
        note: before.note,
      });
    else
      rows.push({
        ...before,
        count: 0,
        status: before.status === "open" ? "fixed" : before.status,
      });
  }
  rows.push(...seen.values());
  return { rows: rows.toSorted((a, b) => b.count - a.count) };
}

function cell(text: string): string {
  return text.replaceAll("|", String.raw`\|`).replaceAll("\n", "⏎");
}

export function toMarkdown(ledger: Ledger, summary: string): string {
  const lines = [
    "# Divergence Ledger",
    "",
    summary,
    "",
    "Set `status` and `note` in `ledger.json`. A rerun keeps them. `exempt` rows count as matches.",
    "",
    "| Status | Inputs | Fingerprint | Example | Old | New | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of ledger.rows) {
    lines.push(
      `| ${r.status} | ${r.count} | \`${cell(r.fingerprint)}\` | ${cell(r.example)} | \`${cell(r.old)}\` | \`${cell(r.new)}\` | ${cell(r.note)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
