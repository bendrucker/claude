#!/usr/bin/env bun
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { perCase, render, SHARED, suiteGraders } from "./graders";
import { CASES, type CaseSpec } from "./spec";
import { good, mutations, trace } from "./traces";

const JUDGE_MODEL = "claude-opus-5-5";

/** Cases whose examples cover every shared grader, since the rest only differ in their kinds. */
const REPRESENTATIVE = new Set([
  "skill-changelog",
  "removal-error-copy",
  "extend-rollback-note",
  "pydantic-support-agent",
]);

const NATIVE_REPLY = [
  "Nobody answers while you work, so decide and write the suite without asking.",
  "The artifact runs on claude-sonnet-5-5.",
  "Write only the suite's files.",
  "Finish with a list of every case in the suite, one per line as `name | tags`.",
];

const PYDANTIC_REPLY = [
  "Nobody answers while you work, so decide and write the dataset without asking.",
  "The agent runs on claude-sonnet-5-5.",
  "Write only the dataset and the files it needs.",
  "Finish with a list of every case in the dataset, one per line as `name | tags`.",
];

export function caseYaml(c: CaseSpec): string {
  const prompt = c.harness === "native" ? NATIVE_REPLY : PYDANTIC_REPLY;
  return `${[
    'schema_version: "1.1"',
    `name: ${c.name}`,
    `tags: [design, ${c.split}, ${c.brief}]`,
    'plugins: ["../../.."]',
    "context:",
    "  scaffold_script: fixture.sh",
    "execution:",
    "  model: claude-sonnet-5-5",
    "  max_turns: 60",
    "  timeout_seconds: 1200",
    "  allowed_tools: [Read, Write, Edit, Glob, Grep, Skill]",
    "  append_system_prompt: >-",
    ...prompt.map((l) => `    ${l}`),
  ].join("\n")}\n`;
}

export function suiteYaml(): string {
  const graders = Object.entries(suiteGraders()).flatMap(([name, cases]) => [
    `  ${name}:`,
    cases.map((c) => `    - ${c}`).join("\n"),
  ]);
  return `${["allow_tools: [Write, Edit]", "inline_references: true", `judge_model: ${JUDGE_MODEL}`, "graders:", ...graders].join("\n")}\n`;
}

/** Every generated file by path relative to the suite. */
export function files(): Record<string, string> {
  const out: Record<string, string> = { "suite.yaml": suiteYaml() };
  for (const [name, s] of Object.entries(SHARED)) {
    out[join("graders", `${name}.md`)] = render(s.grader);
  }
  for (const c of CASES) {
    out[join(c.name, "case.yaml")] = caseYaml(c);
    for (const [name, g] of Object.entries(perCase(c))) {
      out[join(c.name, "graders", `${name}.md`)] = render(g);
    }
    const base = good(c);
    out[join("examples", c.name, "pass.jsonl")] = trace(c, base);
    const all = REPRESENTATIVE.has(c.name);
    for (const m of mutations(c)) {
      if (!all && !m.grader.startsWith("kind-")) continue;
      const stem = join("examples", c.name, `fail-${m.grader}`);
      out[`${stem}.jsonl`] = trace(c, m.apply(base));
      out[`${stem}.yaml`] = `fail: [${m.fails.join(", ")}]\n`;
    }
  }
  return out;
}

export const program = new Command("gen.ts")
  .description("Write the case.yaml, graders, suite.yaml, and examples of the design suite")
  .action(async () => {
    const suite = join(import.meta.dir, "..");
    const all = files();
    await Promise.all(Object.entries(all).map(([f, text]) => Bun.write(join(suite, f), text)));
    console.log(`wrote ${Object.keys(all).length} files`);
  });

if (import.meta.main) await program.parseAsync();
