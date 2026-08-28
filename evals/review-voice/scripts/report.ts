#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";
import { decodeFile } from "../../../packages/decode/index";

// Summarize labeled review-voice candidates: verdict counts and the full text of
// every "bad" case with its note, so the failing phrasings can be lifted into
// tone.md as negative examples.

const argv = cli({
  name: "report",
  flags: {
    data: {
      type: String,
      default: join(import.meta.dirname, "..", "data", "candidates.json"),
      description: "Mined candidates",
    },
    labels: {
      type: String,
      default: join(import.meta.dirname, "..", "labels"),
      description: "Directory of saved labels",
    },
    show: {
      type: String,
      default: "bad",
      description: "Which verdict to print in full (bad, good, skip, all)",
    },
  },
});

const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const Candidate = z.looseObject({
  id: z.string(),
  host: z.string(),
  source: z.string(),
  line: z.number().nullable(),
  body: z.string(),
});

const Label = z.looseObject({
  id: z.string(),
  label: z.enum(["good", "bad", "skip"]),
  note: z.string(),
});
type Label = z.infer<typeof Label>;

async function readLabels(dir: string): Promise<Map<string, Label>> {
  const map = new Map<string, Label>();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return map;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rec = await decodeFile(Label, join(dir, name));
    map.set(rec.id, rec);
  }
  return map;
}

async function main() {
  const candidates = await decodeFile(z.array(Candidate), argv.flags.data);
  const labels = await readLabels(argv.flags.labels);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const counts = { good: 0, bad: 0, skip: 0 };
  for (const l of labels.values()) counts[l.label]++;
  const unlabeled = candidates.length - labels.size;

  console.log(
    table([
      ["verdict", "count"],
      [green("good"), String(counts.good)],
      [red("bad"), String(counts.bad)],
      ["skip", String(counts.skip)],
      [dim("unlabeled"), String(unlabeled)],
      ["total", String(candidates.length)],
    ]),
  );

  const wanted = argv.flags.show === "all" ? ["good", "bad", "skip"] : [argv.flags.show];

  for (const [id, label] of labels) {
    if (!wanted.includes(label.label)) continue;
    const c = byId.get(id);
    if (!c) continue;
    const head = `${label.label.toUpperCase()} ${dim(`[${c.host}] ${c.source}${c.line ? `:${c.line}` : ""}`)}`;
    console.log(label.label === "bad" ? red(head) : green(head));
    if (label.note) console.log(dim(`note: ${label.note}`));
    console.log(c.body);
    console.log(dim("─".repeat(72)));
  }
}

main();
