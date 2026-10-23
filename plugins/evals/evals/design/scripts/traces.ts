import { sharedFor } from "./graders";
import type { CaseSpec, Split } from "./spec";

/** What a session wrote, reduced to the parts the graders read. */
export interface Draft {
  judge: string | undefined;
  /** Each case's name and its tags: the request kind or role, then the split. */
  cases: { name: string; tags: string[] }[];
  llmBar: boolean;
  fixtureText: string;
  removal: boolean;
  survival: boolean;
  tsFile: boolean;
  nativeRef: boolean;
  evaluator: boolean;
  judgeCall: "ok" | "unset" | "no-bar";
}

interface Event {
  name: "Write" | "Skill";
  input: Record<string, unknown>;
}

const ROOT = "plugins/acme/evals/suite";

/** A draft that passes every grader of a case. */
export function good(c: CaseSpec): Draft {
  const cases = c.kinds.flatMap((kind) =>
    c.splits.map((split) => ({ name: `${kind}-${split}`, tags: [kind, split] })),
  );
  cases.push(
    { name: "quiet-one", tags: ["quiet", "dev"] },
    { name: "balance-one", tags: ["balance", "holdout"] },
  );
  return {
    judge: c.harness === "native" ? "claude-opus-5-5" : undefined,
    cases,
    llmBar: true,
    fixtureText: "export const total = 3;\n",
    removal: c.brief === "removal",
    survival: c.brief === "removal",
    tsFile: false,
    nativeRef: false,
    evaluator: true,
    judgeCall: "ok",
  };
}

function line(event: Event, id: number): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: `toolu_${id}`, name: event.name, input: event.input }],
    },
  });
}

function write(file_path: string, content: string): Event {
  return { name: "Write", input: { file_path, content } };
}

function caseYaml(name: string, tags: string[]): string {
  return `schema_version: "1.1"\nname: ${name}\ntags: [${tags.join(", ")}]\nplugins: ["../../.."]\n`;
}

const RUBRIC = "Pass when the reply names the order id. Fail otherwise.";

function dataset(d: Draft): string {
  const judge = {
    ok: `rubric="${RUBRIC}", model="openai:gpt-5"`,
    unset: `rubric="${RUBRIC}"`,
    "no-bar": `rubric="The reply names the order id.", model="openai:gpt-5"`,
  }[d.judgeCall];
  const cases = d.cases.map(
    (k) =>
      `        Case(name="${k.name}", inputs="hello", metadata={"kind": "${k.tags[0]}", "split": "${k.tags[1]}"}),`,
  );
  return [
    "from pydantic_evals import Case, Dataset",
    "from pydantic_evals.evaluators import Contains, LLMJudge",
    "",
    "dataset = Dataset(",
    "    cases=[",
    ...cases,
    "    ],",
    `    evaluators=[${d.evaluator ? "Contains(value='order'), " : ""}LLMJudge(${judge})],`,
    ")",
    "",
  ].join("\n");
}

/** The tool calls and final reply of a session that wrote a draft. */
export function trace(c: CaseSpec, d: Draft): string {
  const events: Event[] = [{ name: "Skill", input: { skill: "evals:design" } }];
  if (c.harness === "native") {
    const judge = d.judge === undefined ? "" : `judge_model: ${d.judge}\n`;
    events.push(write(`${ROOT}/suite.yaml`, `allow_tools: []\n${judge}`));
    for (const k of d.cases) {
      events.push(write(`${ROOT}/${k.name}/case.yaml`, caseYaml(k.name, k.tags)));
    }
    const criterion = d.llmBar
      ? "Pass when the reply names the order id.\n"
      : "The reply names the order id.\n";
    events.push(write(`${ROOT}/graders/reply.md`, `---\ntype: llm\n---\n${criterion}`));
    events.push(write(`${ROOT}/${c.kinds[0]}-dev/fixture.sh`, d.fixtureText));
    if (d.removal) {
      const body = "---\ntype: regex\npattern: 'sorry'\nmatch: not_contains\n---\nNo apology.\n";
      events.push(write(`${ROOT}/graders/no-sorry.md`, body));
    }
    if (d.survival) {
      const body = "---\ntype: regex\npattern: 'E-\\d+'\n---\nThe error code stays.\n";
      events.push(write(`${ROOT}/graders/keeps-code.md`, body));
    }
  } else {
    events.push(write("evals/support_dataset.py", dataset(d)));
    if (d.tsFile) events.push(write("evals/run.ts", "export {};\n"));
    if (d.nativeRef) {
      events.push(write("evals/README.md", "Run `bun evals/native/run.ts evals`.\n"));
    }
  }
  const lines = events.map((e, i) => line(e, i + 1));
  const reply = d.cases.map((k) => `${k.name} | ${k.tags[1]} | ${k.tags[0]}`).join("\n");
  lines.push(JSON.stringify({ type: "result", result: reply }));
  return `${lines.join("\n")}\n`;
}

/** A failing variant of a draft and the graders it must fail. */
export interface Mutation {
  grader: string;
  fails: string[];
  apply: (d: Draft) => Draft;
}

function retag(d: Draft, from: Split, to: Split): Draft {
  const cases = d.cases.map((k) => ({ ...k, tags: k.tags.map((t) => (t === from ? to : t)) }));
  return { ...d, cases };
}

function without(role: string): (d: Draft) => Draft {
  return (d) => ({ ...d, cases: d.cases.filter((k) => k.tags[0] !== role) });
}

/** One mutation per regex grader of a case, each failing that grader and what depends on it. */
export function mutations(c: CaseSpec): Mutation[] {
  const shared = new Set(sharedFor(c));
  const kinds = (split: Split) =>
    c.splits.includes(split) ? c.kinds.map((k) => `kind-${k}-${split}`) : [];
  const out: Mutation[] = [];
  const add = (grader: string, fails: string[], apply: Mutation["apply"]) => {
    if (shared.has(grader)) out.push({ grader, fails, apply });
  };
  add("tag-holdout", ["tag-holdout", ...kinds("holdout")], (d) => retag(d, "holdout", "dev"));
  add("tag-dev", ["tag-dev", ...kinds("dev")], (d) => retag(d, "dev", "holdout"));
  add("split-holdout", ["split-holdout", ...kinds("holdout")], (d) => retag(d, "holdout", "dev"));
  add("split-dev", ["split-dev", ...kinds("dev")], (d) => retag(d, "dev", "holdout"));
  for (const kind of c.kinds) {
    for (const split of c.splits) {
      const name = `kind-${kind}-${split}`;
      out.push({
        grader: name,
        fails: [name],
        apply: (d) => ({
          ...d,
          cases: d.cases.map((k) =>
            k.tags[0] === kind && k.tags[1] === split ? { ...k, tags: ["other", split] } : k,
          ),
        }),
      });
    }
  }
  add("quiet-tag", ["quiet-tag"], without("quiet"));
  add("balance-tag", ["balance-tag"], without("balance"));
  add("quiet-case", ["quiet-case"], without("quiet"));
  add("balance-case", ["balance-case"], without("balance"));
  add("judge-model", ["judge-model"], (d) => ({ ...d, judge: "claude-sonnet-5-5" }));
  add("pass-bar", ["pass-bar"], (d) => ({ ...d, llmBar: false }));
  if (c.harness === "native") {
    add("fixture-clean", ["fixture-clean"], (d) => ({
      ...d,
      fixtureText: "type: regex\npattern: 'total'\n",
    }));
  }
  add("removal-grader", ["removal-grader"], (d) => ({ ...d, removal: false }));
  if (c.brief === "removal") {
    out.push({
      grader: "survival-grader",
      fails: ["survival-grader"],
      apply: (d) => ({ ...d, survival: false }),
    });
  }
  const emptied = [
    "split-holdout",
    "split-dev",
    "quiet-case",
    "balance-case",
    ...c.kinds.flatMap((k) => c.splits.map((s) => `kind-${k}-${s}`)),
    "dataset-written",
  ];
  add("dataset-written", emptied, (d) => ({ ...d, cases: [] }));
  add("deterministic-evaluator", ["deterministic-evaluator"], (d) => ({ ...d, evaluator: false }));
  add("judge-model-py", ["judge-model-py"], (d) => ({ ...d, judgeCall: "unset" }));
  add("pass-bar-py", ["pass-bar-py"], (d) => ({ ...d, judgeCall: "no-bar" }));
  add("no-ts-write", ["no-ts-write"], (d) => ({ ...d, tsFile: true }));
  add("no-native-ref", ["no-native-ref"], (d) => ({ ...d, nativeRef: true }));
  return out;
}
