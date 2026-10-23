import { DECISIONS, type Evidence } from "./evidence";
import { renderBlock } from "./harness";

const HARNESS_LINES = {
  native: "native `claude plugin eval`",
  pydantic: "pydantic-evals, diffed with `report.render(baseline=...)`",
  csv: "a custom runner that writes per-grader run and pass counts as CSV",
} as const;

const files = (prefix: string, replicates: number) =>
  Array.from({ length: replicates }, (_, i) => `${prefix}-${i + 1}`);

const asResults = (names: string[]) => names.map((n) => `results/${n}/aggregate-result.json`);

const version = (v: { version: string; model: string }): string => `${v.version} | ${v.model}`;

function climbLog(e: Evidence): string {
  const { domain, plan } = e;
  const replicates = plan.nBase === 3 ? 1 : 2;
  const base = files("base", replicates);
  const cand = files("cand", replicates);
  const devCases = domain.cases.filter((c) => c.split === "dev");
  const holdoutCases = domain.cases.filter((c) => c.split === "holdout");
  const guards = domain.guards.map((g) => `\`${g.case}/${g.grader}\``).join(", ");
  const runs =
    plan.nBase === 3
      ? "Each column is one results file from `--tag dev --runs 3`, so 3 runs a side per case."
      : "Each results file ran `--tag dev --runs 3`, so each column pools 6 runs a side per case.";
  const holdout =
    plan.holdout === undefined
      ? "Holdout: not run. The climb is still open and no change has been accepted yet."
      : "Holdout: `--tag holdout`, run on the original base and on this candidate as the final commit, 2 replicates of 3 runs a side each.";
  return [
    `# \`${domain.artifact}\` Climb`,
    "",
    "## Setup",
    "",
    `- Target: \`${domain.target}\``,
    `- Suite: \`${domain.suite}\`, ${devCases.length} \`dev\` cases and ${holdoutCases.length} \`holdout\` cases, run on ${HARNESS_LINES[e.harness]}`,
    `- Base SHA: \`${e.sha}\``,
    "",
    "## Columns",
    "",
    "| column | results pooled | `claude --version` | model |",
    "| --- | --- | --- | --- |",
    `| base | ${base.map((b) => `\`${b}\``).join(", ")} | ${version(e.baseVersion)} |`,
    `| candidate | ${cand.map((c) => `\`${c}\``).join(", ")} | ${version(e.candVersion)} |`,
    "",
    runs,
    "",
    "## History",
    "",
    ...plan.history,
    "",
    `## Candidate ${plan.candidate}`,
    "",
    `Hypothesis: ${domain.hypothesis}`,
    "",
    `Target graders, registered before the run: \`${domain.target_grader.case}/${domain.target_grader.grader}\`, with arm, up.`,
    "",
    `Guard graders, registered before the run: ${guards}.`,
    "",
    holdout,
    ...(plan.notes.length > 0 ? ["", ...plan.notes] : []),
  ].join("\n");
}

const REPLY =
  "Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.";

export function prompt(e: Evidence): string {
  const replicates = e.plan.nBase === 3 ? 1 : 2;
  const devResults = (prefix: string) => asResults(files(prefix, replicates)).join(",");
  const holdoutResults = (prefix: string) => asResults(files(prefix, 2)).join(",");
  const dev = renderBlock(e, e.dev, [devResults("base"), devResults("cand")]);
  const holdout =
    e.holdout === undefined
      ? []
      : [
          "## Holdout comparison",
          "",
          renderBlock(e, e.holdout, [
            holdoutResults("holdout-base"),
            holdoutResults("holdout-final"),
          ]),
          "",
        ];
  return [
    `/evals:hill-climb ${e.domain.target} ${e.domain.suite}`,
    "",
    `Candidate ${e.plan.candidate} finished running. Decide it from what's below and tell me why.`,
    "",
    "## `CLIMB.md`, excerpt",
    "",
    "````markdown",
    climbLog(e),
    "````",
    "",
    "## Dev comparison",
    "",
    dev,
    "",
    ...holdout,
    REPLY,
    "",
  ].join("\n");
}

export const SYSTEM = `Nothing can be built or run in this session, and nobody answers while you work, so reply once. End the reply with one line naming your decision on the candidate: ${DECISIONS.map((d) => `\`Decision: ${d}\``).join(", ")}. The names mean: accept the candidate and open its PR, reject it and close with the evidence, more-runs to add runs before reading the rows, stall to stop editing and run the Stall review, stop to end the climb, re-baseline to re-run the baseline before comparing again.`;
