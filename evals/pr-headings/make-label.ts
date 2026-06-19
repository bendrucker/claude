import headings from "./headings.json";

type H = {
  text: string;
  words: number;
  kind: string;
  depth: number;
  url: string;
  mergedAt: string;
};
const hs = (headings as H[]).filter((h) => h.words >= 3);
const seen = new Set<string>();
const rows = hs
  .filter((h) => (seen.has(h.text) ? false : (seen.add(h.text), true)))
  .sort((a, b) => b.words - a.words);
const out = [
  "verdict\twords\tkind\ttext\turl",
  ...rows.map((h) => `\t${h.words}\t${h.kind}\t${h.text}\t${h.url}`),
];
await Bun.write(`${import.meta.dir}/label.tsv`, out.join("\n") + "\n");
console.error(`wrote ${rows.length} unique headings (>=3 words) to label.tsv`);
