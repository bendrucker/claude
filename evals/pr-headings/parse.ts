#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { marked } from "marked";

const dir = `${import.meta.dir}/bodies`;
const manifest: { file: string; url: string; repo: string; title: string }[] = JSON.parse(
  await Bun.file(`${import.meta.dir}/manifest.json`).text(),
);
const byFile = new Map(manifest.map((m) => [m.file, m]));

type Heading = {
  repo: string;
  url: string;
  depth: number;
  text: string;
};

const headings: Heading[] = [];
let prsWithHeadings = 0;
const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));

for (const file of files) {
  const meta = byFile.get(file)!;
  const md = await Bun.file(`${dir}/${file}`).text();
  const tokens = marked.lexer(md);
  let had = false;
  for (const t of tokens) {
    if (t.type === "heading") {
      had = true;
      headings.push({
        repo: meta.repo,
        url: meta.url,
        depth: t.depth,
        // strip inline markdown/links/backticks to raw text
        text: t.text.replace(/\s+/g, " ").trim(),
      });
    }
  }
  if (had) prsWithHeadings++;
}

// Full structured dataset
await Bun.write(`${import.meta.dir}/headings.json`, JSON.stringify(headings, null, 2));

// Flat, human-reviewable list grouped by depth
const lines: string[] = [];
for (const depth of [1, 2, 3, 4, 5, 6]) {
  const hs = headings.filter((h) => h.depth === depth);
  if (!hs.length) continue;
  lines.push(`\n===== H${depth} (${hs.length}) =====\n`);
  for (const h of hs) lines.push(h.text);
}
await Bun.write(`${import.meta.dir}/headings.txt`, lines.join("\n") + "\n");

// Stats
const depthCounts: Record<number, number> = {};
for (const h of headings) depthCounts[h.depth] = (depthCounts[h.depth] ?? 0) + 1;
const wordCounts = headings.map((h) => h.text.split(/\s+/).length);
wordCounts.sort((a, b) => a - b);
const median = wordCounts[Math.floor(wordCounts.length / 2)];
const endsWithPeriod = headings.filter((h) => /[.!?]$/.test(h.text)).length;

console.error(`files parsed: ${files.length}`);
console.error(`PRs with >=1 heading: ${prsWithHeadings}`);
console.error(`total headings: ${headings.length}`);
console.error(`by depth: ${JSON.stringify(depthCounts)}`);
console.error(`median words/heading: ${median}, max: ${wordCounts.at(-1)}`);
console.error(`headings ending in . ! or ?: ${endsWithPeriod}`);
console.error(`\nwrote headings.json, headings.txt`);
