#!/usr/bin/env bun
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { serializeCase, writeCases } from "../../../../../packages/evals/cases";
import { CaseFile, type CaseRecord } from "./case-record";

export const INSTRUCTION =
  "You are in plan mode. Write the plan to `plan.md` in the working directory now, following the planning guidelines in your context.";

export function caseName(c: CaseRecord): string {
  return `case-${c.id}`;
}

export function caseYaml(c: CaseRecord): string {
  return serializeCase({
    schema_version: "1.1",
    name: caseName(c),
    tags: c.tags,
    plugins: ["../.."],
    runs: 1,
    execution: {
      model: "claude-sonnet-5-5",
      max_turns: 8,
      timeout_seconds: 300,
      allowed_tools: ["Read", "Glob", "Grep", "Write"],
    },
  });
}

export function promptMd(c: CaseRecord): string {
  return `${c.prefix}\n\n${INSTRUCTION}\n`;
}

export function graderMd(c: CaseRecord): string {
  return [
    "---",
    "type: llm",
    "focus:",
    "  source: file",
    "  path: plan.md",
    "---",
    "After reading a plan, the user redirected it with the feedback below. Pass when the plan already does what the feedback asks, or explicitly decides the matter and cites its rejection of the alternative, so the user would not have needed to say it. A paraphrase of the same change passes. Fail when the plan leaves it out, or touches it only in passing without acting on it.",
    "",
    "Feedback:",
    "",
    ...c.redirect.split("\n").map((line) => `> ${line}`),
    "",
  ].join("\n");
}

export function files(c: CaseRecord): Record<string, string> {
  const dir = caseName(c);
  return {
    [join(dir, "case.yaml")]: caseYaml(c),
    [join(dir, "prompt.md")]: promptMd(c),
    [join(dir, "graders", "pre-empts-redirect.md")]: graderMd(c),
  };
}

export const program = new Command("generate")
  .description("Write the case-* cases from data/cases.json")
  .action(async () => {
    const suite = join(import.meta.dirname, "..");
    const source = Bun.file(join(suite, "data", "cases.json"));
    if (!(await source.exists())) {
      console.log("wrote 0 cases (data/cases.json is missing)");
      return;
    }
    const cases = CaseFile.parse(await source.json());
    const wanted = Object.fromEntries(cases.flatMap((c) => Object.entries(files(c))));
    await writeCases(suite, wanted, { prefix: "case-" });
    console.log(`wrote ${cases.length} cases`);
  });

if (import.meta.main) await program.parseAsync();
