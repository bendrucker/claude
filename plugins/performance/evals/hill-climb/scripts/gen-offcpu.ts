#!/usr/bin/env bun
import { globSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { OffCpuTruth } from "./offcpu";

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const alt = (ps: string[]) => `(?:${ps.join("|")})`;

function grader(pattern: string, flags: string, match: string, note: string): string {
  return [
    "---",
    "type: regex",
    `pattern: ${quote(pattern)}`,
    `flags: ${flags}`,
    `match: ${match}`,
    "---",
    note,
    "",
  ].join("\n");
}

/** Line-level regex proxies of `scoreOffCpu`, for the runner's own report. */
export function proxies(truth: OffCpuTruth): Record<string, string> {
  const files: Record<string, string> = {};
  for (const c of truth.checks) {
    const pattern = `^${c.all.map((g) => `(?=[^\\n]*${alt(g)})`).join("")}`;
    files[`${c.id}.md`] = grader(pattern, "im", "contains", c.note);
  }
  const traps = truth.traps.flatMap((t) => t.patterns);
  files["no-trap-top2.md"] = grader(
    String.raw`^\s{0,3}[12][.)](?![^\n]*${alt(truth.leads)})[^\n]*${alt(traps)}`,
    "im",
    "not_contains",
    `Neither of the first two candidates is a CPU micro-optimization the profile over-ranks: ${truth.traps.map((t) => t.id).join(", ")}.`,
  );
  return files;
}

export const program = new Command("gen-offcpu.ts")
  .description("Write the regex proxy graders for every offcpu case from its truth.json")
  .action(async () => {
    const suite = join(import.meta.dir, "..");
    const truths = globSync("*/truth.json", { cwd: suite });
    const writes = truths.map(async (file) => {
      const raw: unknown = await Bun.file(join(suite, file)).json();
      const parsed = OffCpuTruth.safeParse(raw);
      if (!parsed.success) return [];
      const files = Object.entries(proxies(parsed.data));
      await Promise.all(
        files.map(([name, text]) => Bun.write(join(suite, dirname(file), "graders", name), text)),
      );
      return [dirname(file)];
    });
    console.log(`wrote graders for ${(await Promise.all(writes)).flat().join(", ")}`);
  });

if (import.meta.main) await program.parseAsync();
