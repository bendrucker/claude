#!/usr/bin/env bun

import { mkdir, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { Command, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { $ } from "bun";
import { table } from "table";
import { z } from "zod";
import { corpusFiles, lintFiles, PLUGINS, type Plugin, ROOT, sweep } from "./corpus";
import {
  assign,
  Corpus,
  DOCS,
  hitId,
  type Label,
  type Pattern,
  type Queued,
  readJsonl,
  store,
  Verdict,
} from "./data";
import { annotations, toFlags } from "./review";
import { sample } from "./sample";
import { labConfig, score } from "./score";
import { serve } from "./server";
import { checkRows, patternRows, render } from "./status";

const BUCKET = "s3://ben-drucker-agents-eval-corpus/prose-lab/data";
const STYLE_PLUGIN = { Prompting: "prompting", Writing: "writing" } as const satisfies Record<
  Pattern["style"],
  Plugin
>;
/** Unlabeled hits queued per candidate, enough for a sitting to test generalization without drowning it. */
const QUEUE_PER_CANDIDATE = 10;
const PLUGIN_NAMES = ["prompting", "writing"] as const satisfies readonly Plugin[];

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const data = store();

const sweepCommand = new Command("sweep")
  .description("Lint the corpus with each plugin's Vale config and save the hits.")
  .addOption(
    new Option("--corpus <name>", "documents to lint")
      .choices(Corpus.options)
      .default("skills" as const),
  )
  .addOption(
    new Option("--plugin <name>", "plugin config to lint with, repeatable")
      .choices(PLUGIN_NAMES)
      .argParser(collect),
  )
  .action(async (options) => {
    const plugins = (options.plugin ?? PLUGIN_NAMES).filter(
      (name): name is Plugin => name in PLUGINS,
    );
    const result = await sweep(options.corpus, plugins);
    await data.writeSweep(result);
    const rate = (result.hits.length / result.words) * 1000;
    console.log(
      `${result.hits.length} hits over ${result.words} words (${rate.toFixed(1)} per 1,000) at ${result.rev}`,
    );
  });

const serveCommand = new Command("serve")
  .description("Serve the labeling page over the last sweep.")
  .option("--port <n>", "port", int, 4317)
  .option("--per-check <n>", "hits sampled per check", int, 5)
  .action(async (options) => {
    const server = await serve(data, { port: options.port, perCheck: options.perCheck });
    const swept = await data.sweep();
    const count = sample(
      swept?.hits ?? [],
      await data.labels(),
      await data.queue(),
      options.perCheck,
    ).length;
    console.log(`${count} hits to label at ${server.url}`);
  });

const patternCommand = new Command("pattern")
  .description("Add or update a pattern.")
  .argument("<slug>", "kebab-case name")
  .requiredOption("--description <text>", "what the anti-pattern is")
  .addOption(
    new Option("--style <style>", "style a rule for it ships in")
      .choices(["Prompting", "Writing"] as const)
      .makeOptionMandatory(),
  )
  .option("--check <name>", "the shipped rule's check, once promoted")
  .action(async (slug, options) => {
    await data.addPatterns([
      { slug, description: options.description, style: options.style, check: options.check },
    ]);
  });

const assignCommand = new Command("assign")
  .description("Assign labels and flags to a pattern.")
  .argument("<slug>", "pattern")
  .argument("<ids...>", "label or flag ids")
  .action(async (slug, ids) => {
    const assigned = assign(
      slug,
      ids,
      await data.labels(),
      await data.flags(),
      new Date().toISOString(),
    );
    await data.addLabels(assigned.labels);
    await data.addFlags(assigned.flags);
  });

/** A path under `DOCS` for `source` that no earlier snapshot took. */
async function snapshotPath(source: string, date: string): Promise<string> {
  const stem = `${date}-${basename(source, extname(source))}`;
  const taken = new Set(await readdir(DOCS));
  let name = `${stem}.md`;
  for (let n = 2; taken.has(name); n++) name = `${stem}-${n}.md`;
  return join(DOCS, name);
}

const reviewCommand = new Command("review")
  .description(
    "Review a document in Plannotator, record its inline comments as flags, and re-sweep.",
  )
  .argument("<file>", "document to review")
  .action(async (file) => {
    const source = resolve(file);
    const original = await Bun.file(source).text();
    const ts = new Date().toISOString();
    await mkdir(DOCS, { recursive: true });
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, "0"))
      .join("-");
    const snapshot = await snapshotPath(source, date);
    const doc = relative(ROOT, snapshot);
    await Bun.write(snapshot, original);
    await data.addDocs([{ doc, source, ts }]);

    const since = new Date();
    const session = Bun.spawn(["plannotator", "annotate", snapshot, "--json"], {
      stdout: "ignore",
      stderr: "inherit",
    });
    if ((await session.exited) !== 0) throw new Error("plannotator exited with an error.");

    if ((await Bun.file(snapshot).text()) !== original) {
      console.log("The session edited the snapshot. Restoring it, since flags index the original:");
      console.log(await $`diff -u - ${snapshot} < ${new Response(original)}`.nothrow().text());
      await Bun.write(snapshot, original);
    }

    const reviewed = toFlags(await annotations(snapshot, since), doc, original.split("\n"), ts);
    await data.addFlags(reviewed.flags);
    for (const note of reviewed.globals) console.log(`Global: ${note}`);
    for (const { type, originalText, text } of reviewed.unlocated)
      console.log(`Unlocated ${type}: ${JSON.stringify(originalText ?? "")} ${text}`);

    const last = await data.sweep();
    const swept = new Set(last?.hits.map((hit) => hit.plugin));
    const plugins = PLUGIN_NAMES.filter((name) => swept.size === 0 || swept.has(name));
    await data.writeSweep(await sweep(last?.corpus ?? "skills", plugins));
    console.log(
      `${reviewed.flags.length} flags recorded on ${doc}, ${reviewed.unlocated.length} unlocated, ${reviewed.globals.length} global notes.`,
    );
  });

const labelCommand = new Command("label")
  .description("Record a model's verdict on a swept or queued hit, kept apart from the user's.")
  .argument("<id>", "hit id")
  .addOption(
    new Option("--verdict <verdict>", "verdict").choices(Verdict.options).makeOptionMandatory(),
  )
  .option("--note <text>", "why", "")
  .option("--pattern <slug>", "pattern the hit belongs to")
  .action(async (id, options) => {
    const swept = await data.sweep();
    const hit = [...(swept?.hits ?? []), ...(await data.queue())].find(
      (entry) => hitId(entry) === id,
    );
    if (hit === undefined) throw new Error(`Unknown hit ${id}.`);
    await data.addLabels([
      {
        ...hit,
        id,
        verdict: options.verdict,
        note: options.note,
        pattern: options.pattern,
        by: "model",
        ts: new Date().toISOString(),
      },
    ]);
  });

const PrototypeLabel = z.object({
  id: z.string(),
  verdict: z.enum(["right", "wrong", "unsure"]),
  note: z.string(),
  ts: z.string(),
});

const importCommand = new Command("import")
  .description("Import labels keyed by hit id from another labels file, against the last sweep.")
  .argument("<file>", "JSONL of {id, verdict, note, ts}")
  .action(async (file) => {
    const swept = await data.sweep();
    if (swept === undefined) throw new Error("No sweep yet. Run `lab.ts sweep` first.");
    const hits = new Map(swept.hits.map((hit) => [hitId(hit), hit]));
    const records = await readJsonl(PrototypeLabel, resolve(file));
    const labels: Label[] = records.flatMap((record) => {
      const hit = hits.get(record.id);
      return hit === undefined ? [] : [{ ...hit, ...record, by: "user" as const }];
    });
    await data.addLabels(labels);
    console.log(
      `Imported ${labels.length} of ${records.length}. The rest name hits the last sweep no longer has.`,
    );
  });

const scoreCommand = new Command("score")
  .description(
    "Score candidate rules for a pattern against the labels, and queue their unlabeled hits.",
  )
  .argument("<pattern>", "pattern slug")
  .argument("<candidates...>", "Vale rule files")
  .action(async (slug, candidates) => {
    const pattern = (await data.patterns()).find((entry) => entry.slug === slug);
    if (pattern === undefined)
      throw new Error(`Unknown pattern ${slug}. Add it with \`lab.ts pattern\`.`);
    const swept = await data.sweep();
    if (swept === undefined) throw new Error("No sweep yet. Run `lab.ts sweep` first.");
    const plugin = STYLE_PLUGIN[pattern.style];
    const files = await corpusFiles(swept.corpus);
    const [labels, flags, queued] = await Promise.all([data.labels(), data.flags(), data.queue()]);
    const ts = new Date().toISOString();
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const config = await labConfig([resolve(candidate)], PLUGINS[plugin]);
        const hits = await lintFiles(plugin, config, files);
        return {
          candidate: basename(candidate, ".yml"),
          ...score(slug, basename(candidate, ".yml"), hits, labels, flags, swept.words, ts),
        };
      }),
    );
    await data.addScores(results.map((result) => result.score));
    const inQueue = new Set(queued.map(hitId));
    const fresh: Queued[] = results.flatMap((result) =>
      sample(
        result.unlabeled.filter((hit) => !inQueue.has(hitId(hit))),
        [],
        [],
        QUEUE_PER_CANDIDATE,
      ).map(({ id: _id, ...hit }) =>
        Object.assign(hit, { pattern: slug, candidate: result.candidate }),
      ),
    );
    await data.enqueue(fresh);
    console.log(
      table([
        [
          "candidate",
          "hits",
          "per 1k",
          "right",
          "wrong",
          "by model",
          "interval",
          "recall",
          "unlabeled",
        ],
        ...results.map(({ candidate, score: s, unlabeled }) => [
          candidate,
          s.hits,
          s.perThousand.toFixed(2),
          s.right,
          s.wrong,
          s.byModel,
          `${Math.round(s.low * 100)}%-${Math.round(s.high * 100)}%`,
          `${Math.round(s.recall * s.positives)}/${s.positives}`,
          unlabeled.length,
        ]),
      ]),
    );
    console.log(`Queued ${fresh.length} unlabeled hits for the next sitting.`);
  });

const statusCommand = new Command("status")
  .description("Report each pattern's stage and each labeled check's precision.")
  .action(async () => {
    const [swept, labels, flags, patterns, scores] = await Promise.all([
      data.sweep(),
      data.labels(),
      data.flags(),
      data.patterns(),
      data.scores(),
    ]);
    process.stdout.write(
      render(
        patternRows(patterns, labels, flags, scores),
        checkRows(swept?.hits ?? [], labels, flags),
        flags.filter((flag) => flag.pattern === undefined).length,
      ),
    );
  });

function syncCommand(direction: "pull" | "push", profile: string) {
  return new Command(direction)
    .description(
      direction === "pull"
        ? "Copy the lab data from the eval bucket."
        : "Upload the lab data to the eval bucket.",
    )
    .option("--profile <name>", "AWS profile", profile)
    .option("--dry-run", "print what would change")
    .action(async (options) => {
      const [from, to] = direction === "pull" ? [BUCKET, data.dir] : [data.dir, BUCKET];
      await $`aws s3 sync ${from} ${to} --exclude ${".*"} --profile ${options.profile} ${options.dryRun ? ["--dryrun"] : []}`;
    });
}

export const program = new Command("lab")
  .description(
    "Flag prose anti-patterns, generalize them into Vale rules, and score the rules against the labels.",
  )
  .addCommand(sweepCommand)
  .addCommand(serveCommand)
  .addCommand(patternCommand)
  .addCommand(assignCommand)
  .addCommand(reviewCommand)
  .addCommand(importCommand)
  .addCommand(labelCommand)
  .addCommand(scoreCommand)
  .addCommand(statusCommand)
  .addCommand(
    new Command("sync")
      .description("Mirror the lab data with the eval bucket.")
      .addCommand(syncCommand("pull", "agents"))
      .addCommand(syncCommand("push", "agents-admin")),
  );

if (import.meta.main) {
  await program.parseAsync();
}
