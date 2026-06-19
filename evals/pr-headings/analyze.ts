#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { marked } from "marked";
import { classifyHeadingBaseline } from "../../plugins/writing/linguistics/heading.ts";

const LOOSEN_DATE = "2026-06-15"; // commit e6ffa06 loosened the template

const dir = `${import.meta.dir}/bodies`;
const manifest: {
  file: string;
  url: string;
  repo: string;
  title: string;
  mergedAt: string;
}[] = JSON.parse(await Bun.file(`${import.meta.dir}/manifest.json`).text());
const byFile = new Map(manifest.map((m) => [m.file, m]));

type H = {
  repo: string;
  url: string;
  mergedAt: string;
  depth: number;
  text: string;
  words: number;
  flagged: boolean;
  kind: string;
};

const headings: H[] = [];
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".md"))) {
  const meta = byFile.get(file)!;
  const tokens = marked.lexer(await Bun.file(`${dir}/${file}`).text());
  for (const t of tokens) {
    if (t.type !== "heading") continue;
    const text = t.text.replace(/\s+/g, " ").trim();
    const v = classifyHeadingBaseline(text);
    headings.push({
      repo: meta.repo,
      url: meta.url,
      mergedAt: meta.mergedAt,
      depth: t.depth,
      text,
      words: text.split(/\s+/).length,
      flagged: v.flagged,
      kind: v.kind,
    });
  }
}

const recent = headings.filter((h) => h.mergedAt >= LOOSEN_DATE);
const historical = headings.filter((h) => h.mergedAt < LOOSEN_DATE);
const rate = (hs: H[]) =>
  hs.length ? ((hs.filter((h) => h.flagged).length / hs.length) * 100).toFixed(1) : "0";

console.error(`total headings: ${headings.length}`);
console.error(
  `historical (<${LOOSEN_DATE}): ${historical.length} headings, classifier-flagged ${rate(historical)}%`,
);
console.error(
  `recent (>=${LOOSEN_DATE}): ${recent.length} headings, classifier-flagged ${rate(recent)}%`,
);

// Word-count distribution
const buckets: Record<string, number> = {};
for (const h of headings) {
  const k = h.words >= 6 ? "6+" : String(h.words);
  buckets[k] = (buckets[k] ?? 0) + 1;
}
console.error(`word-count buckets: ${JSON.stringify(buckets)}`);

// Reviewable report: recent headings (the suspected regression), then all long headings.
const fmt = (h: H) =>
  `[${h.flagged ? "FLAG" : "ok  "}|${h.kind.padEnd(13)}|w${h.words}] ${h.text}  (${h.url})`;

const lines: string[] = [];
lines.push(`# Recent headings (merged on/after ${LOOSEN_DATE}) — ${recent.length}\n`);
for (const h of recent.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))) lines.push(fmt(h));

lines.push(
  `\n\n# All headings with 5+ words (any date) — candidates for run-on/sentence anti-pattern\n`,
);
for (const h of headings.filter((h) => h.words >= 5).sort((a, b) => b.words - a.words))
  lines.push(fmt(h));

lines.push(
  `\n\n# All classifier-FLAGGED headings (any date) — ${headings.filter((h) => h.flagged).length}\n`,
);
for (const h of headings
  .filter((h) => h.flagged)
  .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)))
  lines.push(fmt(h));

await Bun.write(`${import.meta.dir}/report.txt`, lines.join("\n") + "\n");
await Bun.write(`${import.meta.dir}/headings.json`, JSON.stringify(headings, null, 2));
console.error(`\nwrote report.txt (review this) and headings.json`);
