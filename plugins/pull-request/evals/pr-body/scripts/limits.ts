#!/usr/bin/env bun
import { basename, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { table } from "table";
import { z } from "zod";
import { traceReply } from "../../../../../evals/native/load";
import { type Run, Result, score } from "../../../../../evals/native/regrade";
import { CHECKS, ROWS, checkKeys } from "../limits";
import { measureStructure } from "../structure";

// Scores a results directory against the PR-body structure limits, so changing
// a limit doesn't require new sessions.

const ToolResult = z.object({
  type: z.literal("tool_result"),
  content: z.union([
    z.string(),
    z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  ]),
});
const TraceLine = z.looseObject({
  message: z.looseObject({ content: z.unknown() }).optional(),
});

const STUB_BLOCK = /^PR-BODY-BEGIN[^\S\n]*\n([\s\S]*?)\n?^PR-BODY-END[^\S\n]*$/gm;

export interface Body {
  text: string;
  source: "stub" | "reply";
}

function toolResultTexts(trace: string): string[] {
  return trace
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      const line = TraceLine.safeParse(JSON.parse(l));
      const content = line.success ? line.data.message?.content : undefined;
      if (!Array.isArray(content)) return [];
      return content.flatMap((block: unknown) => {
        const result = ToolResult.safeParse(block);
        if (!result.success) return [];
        const { content: c } = result.data;
        return typeof c === "string" ? [c] : [c.map((p) => p.text ?? "").join("")];
      });
    });
}

/** The PR body a run produced: the last stub block in a tool result, else the reply after its `Title:` line. */
export function bodyOf(trace: string): Body | undefined {
  const blocks = toolResultTexts(trace).flatMap((t) => t.matchAll(STUB_BLOCK).toArray());
  const stub = blocks.at(-1)?.[1];
  if (stub !== undefined) return { text: stub, source: "stub" };
  const reply = traceReply(trace);
  const title = reply === undefined ? null : /^Title:.*$/m.exec(reply);
  if (reply === undefined || title === null) return undefined;
  return { text: reply.slice(title.index + title[0].length).trim(), source: "reply" };
}

export function limitRows(body: Body): Run["graders"] {
  const s = measureStructure(body.text);
  return checkKeys.map((key) => ({
    name: ROWS[key],
    passed: s[key] <= CHECKS[key],
    weight: 1,
    scored: true,
    withOnly: false,
    explanation: `${key} ${s[key]} against limit ${CHECKS[key]} (body from ${body.source})`,
  }));
}

export function limitRun(run: Run, arm: string, trace: string): Run {
  const body = bodyOf(trace);
  if (body === undefined) return run;
  const names = new Set<string>(Object.values(ROWS));
  const next = {
    ...run,
    graders: [...run.graders.filter((g) => !names.has(g.name)), ...limitRows(body)],
  };
  return run.score === null ? next : { ...next, score: score(next, arm) };
}

export type Counts = Map<string, Map<string, [passed: number, total: number]>>;

/** Writes `<out>` with the limit rows added to every run that has a body, and returns per-case pass counts. */
export async function applyLimits(results: string, out: string): Promise<Counts> {
  const result = Result.parse(await Bun.file(join(results, "aggregate-result.json")).json());
  const counts: Counts = new Map();
  const names = new Set<string>(Object.values(ROWS));
  const cases = await Promise.all(
    result.cases.map(async (c) => {
      const perCase = new Map<string, [number, number]>();
      counts.set(c.name, perCase);
      const arms = await Promise.all(
        Object.entries(c.arms).map(async ([arm, runs]) => {
          const next = await Promise.all(
            runs.map(async (run, i) => {
              const file = Bun.file(join(results, "traces", `${c.name}-${arm}-${i}.jsonl`));
              if (!(await file.exists())) return run;
              const limited = limitRun(run, arm, await file.text());
              for (const g of limited.graders.filter((x) => names.has(x.name))) {
                const key = `${arm}/${g.name}`;
                const [passed, total] = perCase.get(key) ?? [0, 0];
                perCase.set(key, [passed + (g.passed ? 1 : 0), total + 1]);
              }
              return limited;
            }),
          );
          return [arm, next] as const;
        }),
      );
      return { ...c, arms: Object.fromEntries(arms) };
    }),
  );
  // The aggregates summarize the recorded scores, so a rescored result drops them.
  const { aggregates: _, ...rest } = result;
  await Bun.write(join(out, "aggregate-result.json"), JSON.stringify({ ...rest, cases }, null, 2));
  await $`cp -R ${join(results, "traces")} ${out}/`.quiet().nothrow();
  return counts;
}

const armOf = (key: string) => key.split("/")[0] ?? "";

function cell(m: Map<string, [number, number]>, arm: string, row: string): string {
  const c = m.get(`${arm}/${row}`);
  return c === undefined ? "-" : `${c[0]}/${c[1]}`;
}

export function render(counts: Counts): string {
  const seen = new Set<string>();
  for (const m of counts.values()) for (const key of m.keys()) seen.add(armOf(key));
  const arms = [...seen].toSorted();
  const names = Object.values(ROWS);
  const header = ["case"];
  for (const a of arms) for (const r of names) header.push(`${a} ${r}`);
  const rows: string[][] = [];
  for (const [name, m] of counts) {
    const row = [name];
    for (const a of arms) for (const r of names) row.push(cell(m, a, r));
    rows.push(row);
  }
  return table([header, ...rows]);
}

const program = new Command()
  .description(
    "Add visible-words, max-block, prose-code-spans, path-spans, contrast-phrases, hidden-words, and list-items rows to every run of a results directory, measured on the PR body the run produced. Writes <results-dir>-limits/ beside it for compare.ts.",
  )
  .argument("<results-dir...>", "results directories holding aggregate-result.json and traces/")
  .action(async (dirs) => {
    const outs = dirs.map((dir) => join(dir, "..", `${basename(dir)}-limits`));
    const all = await Promise.all(dirs.map((dir, i) => applyLimits(dir, outs[i] ?? "")));
    for (const [i, counts] of all.entries()) console.log(`${outs[i]}\n${render(counts)}`);
  });

if (import.meta.main) await program.parseAsync();
