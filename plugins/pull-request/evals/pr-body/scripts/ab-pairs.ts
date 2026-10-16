#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import { bodyOf } from "./limits";

// Pairs two eval columns' PR bodies case by case for blind A/B labeling in label/ab-server.ts.

const program = new Command()
  .name("ab-pairs")
  .description("Build blinded body pairs from two eval columns")
  .requiredOption("--a <dirs>", "comma-separated result dirs for arm A (the baseline)")
  .requiredOption("--b <dirs>", "comma-separated result dirs for arm B (the candidate)")
  .option("--a-name <name>", "label stored for arm A", "base")
  .option("--b-name <name>", "label stored for arm B", "candidate")
  .option("--cases <regex>", "case names to include", "^work-")
  .option("--group <name>", "group tag stored on each pair, such as holdout or dev", "dev")
  .option(
    "--out <file>",
    "pairs file to append to",
    join(import.meta.dirname, "..", "data", "ab-pairs.json"),
  )
  .parse();

const opts = program.opts();

const ToolUse = z.object({
  type: z.literal("tool_use"),
  input: z.looseObject({ command: z.string().optional() }),
});
const TraceLine = z.looseObject({ message: z.looseObject({ content: z.unknown() }).optional() });

const HEREDOC = /cat\s+>\s*(\S+)\s+<<-?\s*'?(\w+)'?\n([\s\S]*?)\n\2(?:\n|$)/g;
const BODY_FILE =
  /(?:glab mr (?:create|update)|gh pr (?:create|edit))[^\n]*?--(?:description|body)-file[=\s]+(\S+)/g;

// The body the agent last handed to a create or edit command, recovered from its own heredoc,
// because a piped `| tail` can hide the stub's echo of an edit.
function lastWrittenBody(trace: string): string | undefined {
  const files = new Map<string, string>();
  let last: string | undefined;
  for (const line of trace.split("\n")) {
    if (line.trim() === "") continue;
    const parsed = TraceLine.safeParse(JSON.parse(line));
    const content = parsed.success ? parsed.data.message?.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const use = ToolUse.safeParse(block);
      const command = use.success ? use.data.input.command : undefined;
      if (command === undefined) continue;
      for (const [, file, , text] of command.matchAll(HEREDOC)) files.set(file, text);
      for (const [, file] of command.matchAll(BODY_FILE)) last = files.get(file) ?? last;
    }
  }
  return last;
}

async function bodies(dirs: string): Promise<Map<string, string[]>> {
  const casePattern = new RegExp(opts.cases);
  const paths = (
    await Promise.all(
      dirs.split(",").map(async (dir) => {
        const traces = join(dir, "traces");
        return (await readdir(traces))
          .toSorted()
          .map((name) => ({ name, path: join(traces, name) }));
      }),
    )
  ).flat();
  const read = await Promise.all(
    paths.flatMap(({ name, path }) => {
      const match = /^(.*)-with-\d+\.jsonl$/.exec(name);
      if (match === null || !casePattern.test(match[1])) return [];
      return [
        Bun.file(path)
          .text()
          .then((trace) => ({
            name: match[1],
            body: lastWrittenBody(trace) ?? bodyOf(trace)?.text,
          })),
      ];
    }),
  );
  const byCase = new Map<string, string[]>();
  for (const { name, body } of read)
    if (body !== undefined) byCase.set(name, [...(byCase.get(name) ?? []), body]);
  return byCase;
}

const Pair = z.object({
  id: z.string(),
  group: z.string(),
  case: z.string(),
  left: z.object({ arm: z.string(), body: z.string() }),
  right: z.object({ arm: z.string(), body: z.string() }),
});

const out = Bun.file(opts.out);
const existing = (await out.exists()) ? z.array(Pair).parse(await out.json()) : [];
const [a, b] = await Promise.all([bodies(opts.a), bodies(opts.b)]);
const added: z.infer<typeof Pair>[] = [];
for (const [name, aBodies] of a) {
  const bBodies = b.get(name) ?? [];
  for (let i = 0; i < Math.min(aBodies.length, bBodies.length); i++) {
    const sides = [
      { arm: opts.aName, body: aBodies[i] },
      { arm: opts.bName, body: bBodies[i] },
    ];
    if (Math.random() < 0.5) sides.reverse();
    added.push({
      id: `${opts.group}-${name}-${i}`,
      group: opts.group,
      case: name,
      left: sides[0],
      right: sides[1],
    });
  }
}
const ids = new Set(added.map((p) => p.id));
const pairs = [...existing.filter((p) => !ids.has(p.id)), ...added];
await Bun.write(opts.out, `${JSON.stringify(pairs, null, 2)}\n`);
console.log(`${added.length} pairs added, ${pairs.length} total in ${opts.out}`);
