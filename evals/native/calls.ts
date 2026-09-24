#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";

const ToolUse = z.object({
  type: z.literal("tool_use"),
  name: z.string(),
  input: z.looseObject({ file_path: z.string().optional(), skill: z.string().optional() }),
});
const Assistant = z.object({
  type: z.literal("assistant"),
  message: z.object({ content: z.array(z.unknown()) }),
});

/** Strips a session's temp prefix so the same file reads the same across runs. */
export function shortPath(path: string): string {
  const cwd = path.indexOf("/home/cwd/");
  if (cwd !== -1) return path.slice(cwd + "/home/cwd/".length);
  const plugins = path.lastIndexOf("/plugins/");
  return plugins === -1 ? path : path.slice(plugins + "/plugins/".length);
}

/**
 * Names each tool call in a trace: `Read <path>` for a file read and `Skill <name>` for a skill
 * load, since those show whether a session opened what it was pointed at, and the bare tool
 * name otherwise. A file named in injected skill text never appears here.
 */
export function calls(trace: string): string[] {
  return trace
    .trim()
    .split("\n")
    .flatMap((raw) => {
      const line = Assistant.safeParse(JSON.parse(raw));
      return line.success ? line.data.message.content : [];
    })
    .flatMap((block) => {
      const use = ToolUse.safeParse(block);
      if (!use.success) return [];
      const { name, input } = use.data;
      if (name === "Read" && input.file_path !== undefined)
        return [`Read ${shortPath(input.file_path)}`];
      if (name === "Skill" && input.skill !== undefined) return [`Skill ${input.skill}`];
      return [name];
    });
}

/** For each `<case>/<arm>`, how many runs made each call at least once, and the run total. */
export async function tally(
  results: string[],
): Promise<Map<string, { runs: number; calls: Map<string, number> }>> {
  const traces = results.flatMap((r) =>
    globSync("traces/*.jsonl", { cwd: r }).map((t) => join(r, t)),
  );
  const out = new Map<string, { runs: number; calls: Map<string, number> }>();
  const read = await Promise.all(traces.map(async (t) => [t, await Bun.file(t).text()] as const));
  for (const [path, text] of read) {
    const match = /^(.+)-(with|without)-\d+\.jsonl$/.exec(basename(path));
    if (match === null) continue;
    const key = `${match[1]}/${match[2]}`;
    const cell = out.get(key) ?? { runs: 0, calls: new Map<string, number>() };
    cell.runs += 1;
    for (const call of new Set(calls(text))) cell.calls.set(call, (cell.calls.get(call) ?? 0) + 1);
    out.set(key, cell);
  }
  return out;
}

if (import.meta.main) {
  const argv = cli({
    name: "calls.ts",
    parameters: ["<results...>"],
    flags: {
      match: {
        type: String,
        description: "Only list calls matching this regex, such as 'Read .*references/'",
      },
    },
    help: {
      description:
        "Count the runs in each case and arm that made each tool call, pooled across results directories. Shows whether sessions actually read a reference or loaded a skill, which grepping traces for a filename cannot, since injected skill text names files too.",
    },
  });
  const filter = argv.flags.match === undefined ? undefined : new RegExp(argv.flags.match);
  const cells = await tally(argv._.results);
  const rows = [...cells]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, { runs, calls: counts }]) =>
      [...counts]
        .filter(([call]) => filter === undefined || filter.test(call))
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([call, n]) => [key, call, `${n}/${runs}`]),
    );
  console.log(
    rows.length > 0 ? table([["case/arm", "call", "runs"], ...rows]) : "No matching calls.",
  );
}
