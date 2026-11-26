#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, Option } from "@commander-js/extra-typings";
import { type Capture, firstDivergence } from "./fingerprint";
import { Ledger, merge, type Observation, toMarkdown } from "./ledger";

export interface RunOptions {
  old: string;
  new: string;
  inputs: string[];
  out: string;
  stdin: boolean;
  normalize: string[];
  jobs: number;
  timeout: number;
}

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

async function capture(template: string, input: string, opts: RunOptions): Promise<Capture> {
  const command = opts.stdin ? template : template.replaceAll("{}", shellQuote(input));
  const proc = Bun.spawn(["sh", "-c", command], {
    stdin: opts.stdin ? Bun.file(input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeout,
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, stdout: normalize(stdout, opts), stderr: normalize(stderr, opts) };
}

function normalize(text: string, opts: RunOptions): string {
  let result = text;
  for (const pattern of opts.normalize)
    result = result.replaceAll(new RegExp(pattern, "g"), "<normalized>");
  return result;
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Map<number, R>();
  let next = 0;
  async function worker(): Promise<void> {
    const i = next++;
    const item = items[i];
    if (item === undefined) return;
    results.set(i, await work(item));
    return worker();
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return items.flatMap((_, i) => {
    const r = results.get(i);
    return r === undefined ? [] : [r];
  });
}

async function readLedger(path: string): Promise<Ledger> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { rows: [] };
  return Ledger.parse(await file.json());
}

export async function run(
  opts: RunOptions,
): Promise<{ matched: number; exempt: number; total: number; ledger: Ledger }> {
  const inputs = opts.inputs.toSorted();
  const results = await pool(inputs, opts.jobs, async (input) => {
    const [oldRun, newRun] = await Promise.all([
      capture(opts.old, input, opts),
      capture(opts.new, input, opts),
    ]);
    return { input, divergence: firstDivergence(oldRun, newRun) };
  });

  await mkdir(opts.out, { recursive: true });
  const ledgerPath = resolve(opts.out, "ledger.json");
  const observations: Observation[] = results.flatMap(({ input, divergence }) =>
    divergence ? [{ input, ...divergence }] : [],
  );
  const ledger = merge(await readLedger(ledgerPath), observations);
  const exemptSet = new Set(
    ledger.rows.filter((r) => r.status === "exempt").map((r) => r.fingerprint),
  );

  const exempt = observations.filter((o) => exemptSet.has(o.fingerprint)).length;
  const matched = results.length - observations.length;
  const total = results.length;
  const pct = total > 0 ? (((matched + exempt) / total) * 100).toFixed(1) : "0.0";
  const summary = `match ${matched + exempt}/${total} (${pct}%), ${exempt} exempt, ${ledger.rows.filter((r) => r.count > 0 && r.status !== "exempt").length} open fingerprints`;

  await Bun.write(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  await Bun.write(resolve(opts.out, "ledger.md"), toMarkdown(ledger, summary));
  await Bun.write(
    resolve(opts.out, "results.jsonl"),
    `${results.map((r) => JSON.stringify({ input: r.input, match: !r.divergence, ...r.divergence })).join("\n")}\n`,
  );
  return { matched, exempt, total, ledger };
}

export const program = new Command("diff-run")
  .description(
    "Run an old and a new implementation on the same inputs and write a fingerprinted divergence ledger",
  )
  .requiredOption(
    "--old <command>",
    "old implementation; {} is replaced with the quoted input path",
  )
  .requiredOption(
    "--new <command>",
    "new implementation; {} is replaced with the quoted input path",
  )
  .option("--out <dir>", "directory for ledger.json, ledger.md, and results.jsonl", "tmp/port")
  .option("--stdin", "feed each input on stdin instead of substituting {}", false)
  .option(
    "--normalize <regex...>",
    "replace matches in both outputs before comparing, for fields meaningless by contract",
    [],
  )
  .addOption(new Option("-j, --jobs <n>", "inputs to run at once").default(4).argParser(Number))
  .addOption(
    new Option("--timeout <ms>", "kill a run after this long").default(30_000).argParser(Number),
  )
  .argument("<inputs...>", "input files")
  .action(async (inputs, o) => {
    const { matched, exempt, total, ledger } = await run({ ...o, inputs });
    console.log(`match ${matched + exempt}/${total}, ${exempt} exempt`);
    for (const r of ledger.rows
      .filter((row) => row.count > 0 && row.status !== "exempt")
      .slice(0, 10)) {
      console.log(
        `${String(r.count).padStart(5)}  ${r.status.padEnd(8)} ${r.fingerprint}  (e.g. ${r.example})`,
      );
    }
    console.log(`ledger: ${resolve(o.out, "ledger.md")}`);
    if (matched + exempt < total) process.exitCode = 1;
  });

if (import.meta.main) await program.parseAsync();
