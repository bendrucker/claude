#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import { checkBrief } from "../../../hooks/brief";

const WriteUse = z.object({
  type: z.literal("tool_use"),
  name: z.literal("Write"),
  input: z.object({ file_path: z.string(), content: z.string() }),
});

const AssistantLine = z.object({
  type: z.literal("assistant"),
  message: z.object({ content: z.array(z.unknown()) }),
});

/** The last content the trace wrote to `plan.md`, or null when it never wrote one. */
export function lastPlan(trace: string): string | null {
  let plan: string | null = null;
  for (const line of trace.split("\n")) {
    if (line.trim() === "") continue;
    const parsed = AssistantLine.safeParse(JSON.parse(line));
    if (!parsed.success) continue;
    for (const block of parsed.data.message.content) {
      const write = WriteUse.safeParse(block);
      if (write.success && write.data.input.file_path.endsWith("/plan.md")) {
        plan = write.data.input.content;
      }
    }
  }
  return plan;
}

export interface Score {
  run: string;
  wrote: boolean;
  problems: string[];
}

/** Scores one trace with the gate's checker, as a first presentation. */
export function scoreTrace(run: string, trace: string): Score {
  const plan = lastPlan(trace);
  if (plan === null) return { run, wrote: false, problems: ["no plan.md written"] };
  return { run, wrote: true, problems: checkBrief(plan, { revisionRequired: false }) };
}

export const program = new Command("brief-score")
  .description("Score each run's plan.md with the brief gate's checker")
  .argument("<results...>", "results directories written by evals/native/run.ts")
  .action(async (results) => {
    const reports = await Promise.all(results.map(scoreDir));
    for (const report of reports) console.log(report);
  });

async function scoreDir(dir: string): Promise<string> {
  const traces = join(dir, "traces");
  const names = (await readdir(traces)).filter((n) => n.endsWith(".jsonl")).toSorted();
  const scores = await Promise.all(
    names.map(async (n) => scoreTrace(n, await Bun.file(join(traces, n)).text())),
  );
  const failed = scores.filter((score) => score.problems.length > 0);
  return [
    `${dir}: brief-shape ${scores.length - failed.length}/${scores.length}`,
    ...failed.map((score) => `  ${score.run}: ${score.problems.join(" | ")}`),
  ].join("\n");
}

if (import.meta.main) await program.parseAsync();
