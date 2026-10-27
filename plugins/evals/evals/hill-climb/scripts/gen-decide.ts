#!/usr/bin/env bun
import { globSync } from "node:fs";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { all, type Decision, DECISIONS, type Evidence } from "./evidence";
import { prompt, SYSTEM } from "./prompt";

const DECISION_PATTERN: Record<Decision, string> = {
  accept: "accept",
  reject: "reject",
  "more-runs": "more[- ]runs",
  stall: "stall",
  stop: "stop",
  "re-baseline": "re-?baseline",
};

const LINE = "^[\\s>*_#-]*decision[*_\\s]*:[*_\\s`]*";
const ANY = DECISIONS.map((d) => DECISION_PATTERN[d]).join("|");

/** A `Decision:` line naming `decision` with no later `Decision:` line after it. */
export function lastDecision(decision: Decision): string {
  return String.raw`${LINE}(?:${DECISION_PATTERN[decision]})\b(?![\s\S]*${LINE}(?:${ANY})\b)`;
}

/** Wraps a sentence to 76 columns for a folded YAML scalar. */
function fold(text: string, indent: string): string {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current !== "" && current.length + word.length + 1 > 76) {
      lines.push(current);
      current = word;
    } else {
      current = current === "" ? word : `${current} ${word}`;
    }
  }
  lines.push(current);
  return lines.map((l) => `${indent}${l}`).join("\n");
}

/** Accept is where the skill dispatches `evals:review`, so those cases can call `Agent`. */
const reviews = (e: Evidence) => e.trap.expected === "accept";

export function caseYaml(e: Evidence): string {
  return `${[
    'schema_version: "1.1"',
    `name: ${e.name}`,
    `tags: [decide, ${e.split}, ${e.harness}]`,
    'plugins: ["../../.."]',
    "execution:",
    "  model: claude-sonnet-5-5",
    "  max_turns: 4",
    `  timeout_seconds: ${reviews(e) ? 600 : 300}`,
    `  allowed_tools: [${reviews(e) ? "Skill, Agent" : "Skill"}]`,
    "  append_system_prompt: >-",
    fold(SYSTEM, "    "),
  ].join("\n")}\n`;
}

/** Native-only tooling. `compare.ts` reads another harness only through `--adapter`. */
const NEUTRAL = String.raw`(?:compare|regrade|calls|run)\.ts(?![^\n\x60]*--adapter)`;

/** The grader files a case carries, by file name. */
export function graders(e: Evidence): Record<string, string> {
  const decision = lastDecision(e.trap.expected);
  const guard = e.domain.guards[0]?.grader ?? "";
  const lookahead = e.trap.reason
    .map((group) => {
      const alternatives = group.map((a) => a.replaceAll("{guard}", guard)).join("|");
      return `(?=[\\s\\S]*(?:${alternatives}))`;
    })
    .join("");
  const out: Record<string, string> = {
    "decision.md": [
      "---",
      "type: regex",
      `pattern: '${decision}'`,
      "flags: im",
      "match: contains",
      "---",
      `The reply's last \`Decision:\` line is \`${e.trap.expected}\`. ${e.trap.note}`,
      "",
    ].join("\n"),
    "reason.md": [
      "---",
      "type: regex",
      `pattern: '^(?<![\\s\\S])(?=[\\s\\S]*${decision})${lookahead.replaceAll("'", "''")}'`,
      "flags: im",
      "match: contains",
      "---",
      `The reply's last \`Decision:\` line is \`${e.trap.expected}\` and its reason names the cause. ${e.trap.note}`,
      "",
    ].join("\n"),
  };
  if (e.harness !== "native") {
    out["neutral.md"] = [
      "---",
      "type: regex",
      `pattern: '${NEUTRAL}'`,
      "flags: i",
      "match: not_contains",
      "---",
      "The reply does not send anyone to native-only tooling. This case's columns come from another harness, which the eval scripts reach only through `--adapter`.",
      "",
    ].join("\n");
  }
  if (reviews(e)) {
    out["review-dispatched.md"] = [
      "---",
      "type: tool_used",
      "tool: Agent",
      "input_match: 'evals:review'",
      "arm: with-only",
      "---",
      "The session dispatched the `evals:review` agent before accepting.",
      "",
    ].join("\n");
  }
  return out;
}

/** Every file of a case by path relative to the suite. */
export function files(e: Evidence): Record<string, string> {
  const out: Record<string, string> = {
    [join(e.name, "case.yaml")]: caseYaml(e),
    [join(e.name, "prompt.md")]: prompt(e),
  };
  for (const [file, text] of Object.entries(graders(e))) out[join(e.name, "graders", file)] = text;
  return out;
}

export const program = new Command("gen-decide.ts")
  .description("Write the decide-* cases from truth.json")
  .action(async () => {
    const suite = join(import.meta.dir, "..");
    const old = globSync("decide-*", { cwd: suite }).map((d) => join(suite, d));
    if (old.length > 0) await $`rm -rf ${old}`;
    const cases = all();
    await Promise.all(
      cases.flatMap((c) =>
        Object.entries(files(c)).map(([f, text]) => Bun.write(join(suite, f), text)),
      ),
    );
    console.log(`wrote ${cases.length} cases`);
  });

if (import.meta.main) await program.parseAsync();
