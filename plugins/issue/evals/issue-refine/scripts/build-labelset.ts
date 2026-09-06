#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";
import { decodeFile } from "../../../../../packages/decode/index";
import { parseIssue } from "./frontmatter";

const Brief = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  size: z.string().optional(),
  project: z.string().optional(),
  brief: z.string(),
});

// Assembles a labeling dataset from generated issues. Pairs each brief in
// briefs/label/ with the refined artifact an agent wrote to data/label-out/<id>.md,
// reads the title from its frontmatter, and writes a samples.json the label
// server can serve with --data. The briefs are synthetic, so unlike the
// real-usage dataset this set is reproducible and safe to track.

const argv = cli({
  name: "build-labelset",
  flags: {
    briefs: {
      type: String,
      default: `${import.meta.dir}/../briefs/label`,
      description: "Directory of brief JSON files",
    },
    out: {
      type: String,
      default: `${import.meta.dir}/../data/label-out`,
      description: "Directory of generated <id>.md issues",
    },
    output: {
      type: String,
      default: `${import.meta.dir}/../data/label-set.json`,
      description: "Samples file to write",
    },
  },
});

const files = (await readdir(argv.flags.briefs)).filter((f) => f.endsWith(".json")).toSorted();

const loaded = await Promise.all(
  files.map(async (f) => {
    const brief = await decodeFile(Brief, join(argv.flags.briefs, f));
    const id = brief.id ?? basename(f, ".json");
    const file = Bun.file(join(argv.flags.out, `${id}.md`));
    if (!(await file.exists())) return { id, sample: null };
    const { title, type, body } = parseIssue(await file.text());
    return {
      id,
      sample: {
        id,
        type:
          typeof brief.type === "string" && brief.type !== ""
            ? brief.type
            : type !== ""
              ? type
              : "unknown",
        size: brief.size ?? "full",
        project: brief.project ?? "synthetic",
        brief: brief.brief,
        title,
        refined: body,
      },
    };
  }),
);

const samples: unknown[] = loaded.flatMap((entry) => (entry.sample ? [entry.sample] : []));
const missing: string[] = loaded.filter((entry) => !entry.sample).map((entry) => entry.id);

await Bun.write(argv.flags.output, JSON.stringify(samples, null, 2));
console.log(`wrote ${samples.length} samples to ${argv.flags.output}`);
if (missing.length > 0) console.log(`missing output for: ${missing.join(", ")}`);
