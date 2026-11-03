#!/usr/bin/env bun

import { parse } from "yaml";
import { z } from "zod";
import { decode } from "../packages/decode/index";
import { root } from "./assets";
import { readTracked, runCheck, tracked } from "./check";

const Rule = z.looseObject({
  tests: z.array(z.looseObject({ name: z.string(), input: z.string() })).optional(),
});
type Rule = z.infer<typeof Rule>;

const VERBS = new Set(["flags", "allows"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Whether a case name, after its leading verb, is a run of words lifted from its input. */
export function restates(name: string, input: string): boolean {
  const named = words(name);
  if (VERBS.has(named[0] ?? "")) named.shift();
  if (named.length === 0) return false;
  return ` ${words(input).join(" ")} `.includes(` ${named.join(" ")} `);
}

export function violations(path: string, rule: Rule): string[] {
  return (rule.tests ?? [])
    .filter((test) => restates(test.name, test.input))
    .map((test) => `${path}:${test.name}`);
}

export async function load(): Promise<string[]> {
  const files = await tracked("plugins/*/styles/*/*.yml", root);
  const found = await Promise.all(
    files.map(async (file) => {
      const text = await readTracked(file, root);
      return text === null ? [] : violations(file, decode(Rule, parse(text), file));
    }),
  );
  return found.flat();
}

if (import.meta.main) {
  await runCheck(
    async () => ({
      header: "Vale test names restate their input. Name the boundary each case pins instead.",
      violations: await load(),
    }),
    { success: "Every Vale test name states a boundary" },
  );
}
