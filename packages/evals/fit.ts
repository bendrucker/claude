/** GitHub rejects a check-run `output.summary` longer than this many characters. */
export const SUMMARY_LIMIT = 65_535;

/** Counts code points, the unit GitHub measures the summary in. */
export function chars(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** Splits a report into whole `<details>` sections and blank-line-separated blocks, each keeping its trailing newlines. */
function blocks(report: string): string[] {
  const out: string[] = [];
  let current = "";
  let open = false;
  for (const line of report.split(/(?<=\n)/)) {
    if (!open && line.trim() === "" && current !== "") {
      out.push(current + line);
      current = "";
      continue;
    }
    if (line.startsWith("<details>")) open = true;
    if (line.startsWith("</details>")) open = false;
    current += line;
  }
  if (current !== "") out.push(current);
  return out;
}

/**
 * Fits a markdown report under `limit` characters by dropping whole blocks, collapsed sections
 * last-first before anything open, and noting the cut with a link to the full report.
 */
export function fit(report: string, link: string, limit = SUMMARY_LIMIT): string {
  if (chars(report) <= limit) return report;
  const kept = blocks(report);
  const note = (dropped: number) =>
    `\n_${dropped} section${dropped === 1 ? "" : "s"} cut to fit GitHub's check summary limit. [Full report](${link})._\n`;
  const fits = (dropped: number) => chars(kept.join("") + note(dropped)) <= limit;
  let dropped = 0;
  const drop = (pick: (block: string) => boolean) => {
    for (let i = kept.length - 1; i > 0 && !fits(dropped); i--) {
      if (!pick(kept[i] ?? "")) continue;
      kept.splice(i, 1);
      dropped++;
    }
  };
  drop((block) => block.startsWith("<details>"));
  drop(() => true);
  if (fits(dropped)) return kept.join("") + note(dropped);

  const budget = limit - chars(note(dropped + 1));
  let head = "";
  for (const line of (kept[0] ?? "").split(/(?<=\n)/)) {
    if (chars(head + line) > budget) break;
    head += line;
  }
  return head + note(dropped + 1);
}
