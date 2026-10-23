import {
  FIXTURE_PATH,
  GRADER_TEXT,
  JUDGE_MODEL,
  LLM_NO_BAR,
  listed,
  PYDANTIC_JUDGE_NO_BAR,
  PYDANTIC_JUDGE_UNSET,
  REMOVAL,
  survival,
  taggedCase,
  toPath,
  touched,
  written,
  writtenTo,
} from "./patterns";
import { CASES, type CaseSpec } from "./spec";

export interface Grader {
  /** Frontmatter lines after `type`. */
  fields: string[];
  type: "regex" | "tool_used" | "file_exists" | "llm";
  body: string;
}

/** A single-quoted YAML scalar. */
function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

export function render(g: Grader): string {
  return `${["---", `type: ${g.type}`, ...g.fields, "---"].join("\n")}\n${g.body}\n`;
}

function trace(pattern: string, body: string, match: "contains" | "not_contains", flags = "") {
  return {
    type: "regex",
    fields: [
      "target: trace",
      `pattern: ${quote(pattern)}`,
      ...(flags === "" ? [] : [`flags: ${flags}`]),
      `match: ${match}`,
    ],
    body,
  } satisfies Grader;
}

/** The reply's own case list, the one place a dataset built through helpers states each case's tags. */
function reply(pattern: string, body: string) {
  return {
    type: "regex",
    fields: ["target: last_message", `pattern: ${quote(pattern)}`, "flags: m", "match: contains"],
    body,
  } satisfies Grader;
}

const NO_TS = toPath(String.raw`\.tsx?`);

const NO_NATIVE = touched(String.raw`evals/native`);

const EVALUATOR = String.raw`\b(?:Contains|Equals|EqualsExpected|IsInstance|MaxDuration|HasMatchingSpan)\(|\(Evaluator\)`;

/** Graders every case in the suite shares, by name. */
export const SHARED: Record<string, { cases: (c: CaseSpec) => boolean; grader: Grader }> = {
  "holdout-share": {
    cases: () => true,
    grader: {
      type: "llm",
      fields: ["focus: last_message"],
      body: [
        "Read the reply's list of the suite's cases and their tags.",
        "Pass when at least 25% and at most 45% of the listed cases carry a `holdout` tag. 2 of 6, 3 of 8, and 4 of 10 pass, and so does a reply that groups the cases by tag and states the counts in a sentence.",
        "Fail when the share is below 25% or above 45%, such as 0 of 6, 1 of 10, or 3 of 5, or when no cases are listed.",
      ].join(" "),
    },
  },
  "fixture-clean": {
    cases: () => true,
    grader: trace(
      writtenTo(FIXTURE_PATH, GRADER_TEXT),
      "No fixture the session wrote holds grader text, since a Read or Grep in the case's working directory would find it.",
      "not_contains",
      "i",
    ),
  },
  "tag-holdout": {
    cases: (c) => c.harness === "native",
    grader: trace(taggedCase("holdout"), "The session tagged a case `holdout`.", "contains"),
  },
  "tag-dev": {
    cases: (c) => c.harness === "native" && c.brief !== "extend",
    grader: trace(taggedCase("dev"), "The session tagged a case `dev`.", "contains"),
  },
  "quiet-tag": {
    cases: (c) => c.harness === "native",
    grader: trace(
      taggedCase("quiet"),
      "A case where the artifact should stay quiet is tagged `quiet`.",
      "contains",
    ),
  },
  "balance-tag": {
    cases: (c) => c.harness === "native",
    grader: trace(
      taggedCase("balance"),
      "A case where the artifact should change little is tagged `balance`.",
      "contains",
    ),
  },
  "judge-model": {
    cases: (c) => c.harness === "native",
    grader: trace(
      written(JUDGE_MODEL),
      "A `suite.yaml` sets `judge_model` to a model other than the one under test.",
      "contains",
    ),
  },
  "pass-bar": {
    cases: (c) => c.harness === "native",
    grader: trace(
      LLM_NO_BAR,
      "Every `llm` grader the session wrote states a pass bar.",
      "not_contains",
      "i",
    ),
  },
  "examples-exist": {
    cases: (c) => c.harness === "native",
    grader: {
      type: "file_exists",
      fields: ["path: '**/examples/*/*'"],
      body: "The suite ships `examples/` for `check.ts` to test.",
    },
  },
  "split-holdout": {
    cases: (c) => c.harness === "pydantic",
    grader: reply(listed("holdout"), "The reply lists a case tagged `holdout`."),
  },
  "split-dev": {
    cases: (c) => c.harness === "pydantic",
    grader: reply(listed("dev"), "The reply lists a case tagged `dev`."),
  },
  "quiet-case": {
    cases: (c) => c.harness === "pydantic",
    grader: reply(listed("quiet"), "The reply lists a case tagged `quiet`."),
  },
  "balance-case": {
    cases: (c) => c.harness === "pydantic",
    grader: reply(listed("balance"), "The reply lists a case tagged `balance`."),
  },
  "dataset-written": {
    cases: (c) => c.harness === "pydantic",
    grader: trace(
      writtenTo(String.raw`\.py`, String.raw`\bDataset\(`, String.raw`\bCase\(`),
      "The session wrote a pydantic-evals `Dataset` of `Case`s to a Python file.",
      "contains",
    ),
  },
  "deterministic-evaluator": {
    cases: (c) => c.harness === "pydantic",
    grader: trace(
      writtenTo(String.raw`\.py`, EVALUATOR),
      "The dataset grades with a deterministic evaluator before any judge.",
      "contains",
    ),
  },
  "judge-model-py": {
    cases: (c) => c.harness === "pydantic",
    grader: trace(
      written(PYDANTIC_JUDGE_UNSET),
      "Every `LLMJudge` sets `model=` to something other than the agent's model.",
      "not_contains",
    ),
  },
  "pass-bar-py": {
    cases: (c) => c.harness === "pydantic",
    grader: trace(
      written(PYDANTIC_JUDGE_NO_BAR),
      "Every `LLMJudge` states a pass bar in its rubric.",
      "not_contains",
      "i",
    ),
  },
  "no-ts-write": {
    cases: (c) => c.harness === "pydantic",
    grader: trace(NO_TS, "The session wrote no TypeScript file.", "not_contains"),
  },
  "no-native-ref": {
    cases: (c) => c.harness === "pydantic",
    grader: trace(
      NO_NATIVE,
      "Nothing the session wrote or edited names `evals/native`, which only runs native suites.",
      "not_contains",
    ),
  },
  "no-native-files": {
    cases: (c) => c.harness === "pydantic",
    grader: {
      type: "file_exists",
      fields: ["path: '**/{case,suite}.yaml'", "exists: false"],
      body: "A pydantic-evals project gets no native `case.yaml` or `suite.yaml`.",
    },
  },
  "removal-grader": {
    cases: (c) => c.brief === "removal",
    grader: trace(
      REMOVAL,
      "A grader fails a reply for containing the text the change removes.",
      "contains",
    ),
  },
};

/** Graders for one case that depend on its spec. */
export function perCase(c: CaseSpec): Record<string, Grader> {
  const out: Record<string, Grader> = {};
  for (const kind of c.kinds) {
    for (const split of c.splits) {
      const body = `A \`${kind}\` case is tagged \`${split}\`.`;
      out[`kind-${kind}-${split}`] =
        c.harness === "native"
          ? trace(taggedCase(kind, split), body, "contains")
          : reply(listed(kind, split), body);
    }
  }
  if (c.fact !== undefined) {
    out["survival-grader"] = trace(
      survival(c.fact),
      "A grader without `not_contains` checks the fact the removal must leave in place.",
      "contains",
      "i",
    );
  }
  return out;
}

/** Shared grader names that apply to a case. */
export function sharedFor(c: CaseSpec): string[] {
  return Object.entries(SHARED)
    .filter(([, s]) => s.cases(c))
    .map(([name]) => name);
}

/** The `graders:` map of `suite.yaml`: each shared grader to the cases that join it. */
export function suiteGraders(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(SHARED).map(([name, s]) => [
      name,
      CASES.filter((c) => s.cases(c)).map((c) => c.name),
    ]),
  );
}
