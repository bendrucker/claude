#!/usr/bin/env bun
import { join } from "node:path";
import { CASES, type CaseSpec, SEEDS } from "./spec";

const suite = join(import.meta.dir, "..");

interface PullFile {
  title: string;
  headRefName: string;
}

function isPullFile(v: unknown): v is PullFile {
  return (
    typeof v === "object" &&
    v !== null &&
    "title" in v &&
    typeof v.title === "string" &&
    "headRefName" in v &&
    typeof v.headRefName === "string"
  );
}

async function pull(seed: string): Promise<PullFile> {
  const pr: unknown = await Bun.file(join(suite, "seeds", seed, "pr.json")).json();
  if (!isPullFile(pr)) throw new Error(`seeds/${seed}/pr.json lacks a title or headRefName`);
  return { title: pr.title, headRefName: pr.headRefName };
}

const SUITE_YAML = `allow_tools: [Bash]
stage: [packages/eval-stubs]
judge_model: claude-opus-5-5
graders:
  review-dispatched: "*"
`;

const DISPATCHED = `---
type: tool_used
tool: Agent
input_match: 'evals:review'
arm: with-only
---
The session dispatched the \`evals:review\` agent.
`;

function caseYaml(c: CaseSpec): string {
  return `schema_version: "1.1"
name: ${c.name}
tags: [review, ${c.split}, ${c.seed}]
plugins: ["../../.."]
context:
  scaffold_script: fixture.sh
execution:
  model: claude-sonnet-5-5
  max_turns: 60
  timeout_seconds: 1200
  allowed_tools: [Read, Glob, Grep, Bash, Agent]
  append_system_prompt: >-
    Nobody answers while you work, so decide without asking.
    Leave the PR as it is: no comments, edits, or merges.
`;
}

function prompt(c: CaseSpec): string {
  const { pr } = SEEDS[c.seed] ?? { pr: 0 };
  return `Before I merge https://github.com/bendrucker/claude/pull/${pr}, tell me whether the gain it claims holds up. The repository is checked out here on the PR's branch, and \`gh\` reaches the PR. The results of every run its body links are downloaded under \`runs/<run id>/aggregate-result.json\`.

End the reply with each problem you found on its own line starting \`Problem:\`, or \`Problem: none\`, then a last line reading \`Verdict: holds\` or \`Verdict: fails\`.
`;
}

function fixture(c: CaseSpec, p: PullFile): string {
  const { pr, date } = SEEDS[c.seed] ?? { pr: 0, date: "" };
  return `#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
stubs="$here/../../../../../packages/eval-stubs"
seed="$here/../seeds/${c.seed}"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/bendrucker/claude.git
tar --extract --file "$seed/tree.tar"
base=$(commit ${date} "Base of #${pr}")
git checkout -q -b ${p.headRefName}
git apply "$seed/change.patch"
bun "$here/../scripts/plant.ts" tree ${c.plant} "$seed" .
head=$(commit ${date} ${JSON.stringify(p.title)})
bun "$here/../scripts/plant.ts" data ${c.plant} "$seed" "$PWD" "$base" "$head"
`;
}

function verdict(c: CaseSpec): string {
  return `---
type: regex
target: last_message
pattern: '^[*_ ]*Verdict[*_ ]*:[*_ ]*${c.verdict}\\b'
flags: mi
match: contains
---
The reply ends on \`Verdict: ${c.verdict}\`.
`;
}

function namesFlaw(flaw: string): string {
  return `---
type: llm
focus: last_message
---
Pass when the reply names, as a reason the claimed gain doesn't hold, that ${flaw}. A paraphrase passes. Fail when the reply doesn't raise it, or raises it only to dismiss it.
`;
}

/** Every generated file, keyed by its path in the suite. */
export async function files(): Promise<Record<string, string>> {
  const out: Record<string, string> = {
    "suite.yaml": SUITE_YAML,
    "graders/review-dispatched.md": DISPATCHED,
  };
  const pulls = await Promise.all(CASES.map((c) => pull(c.seed)));
  for (const [i, c] of CASES.entries()) {
    const p = pulls[i];
    if (p === undefined) continue;
    out[`${c.name}/case.yaml`] = caseYaml(c);
    out[`${c.name}/prompt.md`] = prompt(c);
    out[`${c.name}/fixture.sh`] = fixture(c, p);
    out[`${c.name}/graders/verdict.md`] = verdict(c);
    if (c.flaw !== undefined) out[`${c.name}/graders/names-flaw.md`] = namesFlaw(c.flaw);
    const other = c.verdict === "holds" ? "fails" : "holds";
    const problem = c.verdict === "holds" ? "none" : "the claimed gain doesn't hold";
    out[`examples/${c.name}/pass.md`] = `Problem: ${problem}\n\n**Verdict:** ${c.verdict}\n`;
    out[`examples/${c.name}/fail.md`] =
      `---\nfail: [verdict]\n---\nProblem: none\n\nVerdict: ${other}\n`;
  }
  return out;
}

if (import.meta.main) {
  const out = await files();
  await Promise.all(Object.entries(out).map(([path, text]) => Bun.write(join(suite, path), text)));
  console.log(`wrote ${Object.keys(out).length} files`);
}
