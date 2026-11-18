import { describe, expect, it } from "bun:test";
import { checkBrief, stripRevised } from "./brief";

interface Plan {
  title: string;
  approach: string[];
  decisions: string[];
  measure: string | null;
  revised: string[] | null;
  rest: string;
}

function makePlan(overrides: Partial<Plan> = {}): string {
  const plan: Plan = {
    title: "# Rework the gate",
    approach: ["Approach: gate the brief by structure."],
    decisions: ["Gate by structure. Rejected: a character cap (`gate.ts:189`)."],
    measure: "Measure: deterministic → `bun test`.",
    revised: null,
    rest: "## Context\n\nThe gate denies over 10k.\n",
    ...overrides,
  };
  return [
    plan.title,
    "## Brief",
    ...plan.approach,
    ...(plan.revised === null ? [] : ["Revised:", plan.revised.map((r) => `- ${r}`).join("\n")]),
    "Decisions:",
    plan.decisions.map((d) => `- ${d}`).join("\n"),
    ...(plan.measure === null ? [] : [plan.measure]),
    plan.rest,
  ].join("\n\n");
}

const first = { revisionRequired: false };

describe("checkBrief", () => {
  it("passes a plan in the guidelines' shape", () => {
    expect(checkBrief(makePlan(), first)).toEqual([]);
  });

  it.each<{ name: string; plan: string; revisionRequired?: boolean }>([
    { name: "no Brief heading", plan: "# Title\n\n## Context\n\nText.\n" },
    { name: "Brief not first H2", plan: `# T\n\n## Context\n\nx\n\n${makePlan({ title: "" })}` },
    { name: "two paragraphs before Decisions", plan: makePlan({ approach: ["One.", "Two."] }) },
    { name: "no Decisions line", plan: makePlan().replace("Decisions:", "Choices:") },
    {
      name: "six decisions",
      plan: makePlan({ decisions: Array.from({ length: 6 }, () => "X. Rejected: Y (`a.ts:1`).") }),
    },
    { name: "uncited rejection", plan: makePlan({ decisions: ["X. Rejected: Y, by feel."] }) },
    {
      name: "citation before the label",
      plan: makePlan({ decisions: ["`a.ts` X. Rejected: Y."] }),
    },
    { name: "no Measure line", plan: makePlan({ measure: null }) },
    { name: "revision without Revised", plan: makePlan(), revisionRequired: true },
  ])("flags $name", ({ plan, revisionRequired = false }) => {
    expect(checkBrief(plan, { revisionRequired })).toMatchSnapshot();
  });

  it.each<{ name: string; decision: string }>([
    { name: "a code span", decision: "X. Rejected: Y (`a.ts:1`)." },
    { name: "a link", decision: "X. Rejected: Y ([sidecar](plan-evals.md))." },
    { name: "a bold label", decision: "X. **Rejected:** Y (`a.ts:1`)." },
  ])("accepts a rejection cited with $name", ({ decision }) => {
    expect(checkBrief(makePlan({ decisions: [decision] }), first)).toEqual([]);
  });

  it("accepts a revision that lists what changed", () => {
    const plan = makePlan({ revised: ["Dropped the cap."] });
    expect(checkBrief(plan, { revisionRequired: true })).toEqual([]);
  });

  it("counts no Revised paragraph against the one before Decisions", () => {
    const plan = makePlan({ revised: ["Dropped the cap."] });
    expect(checkBrief(plan, first)).toEqual([]);
  });
});

describe("stripRevised", () => {
  it("removes the Revised line and list and nothing else", () => {
    const plan = makePlan({ revised: ["Dropped the cap.", "Added a test."] });
    expect(stripRevised(plan)).toBe(makePlan());
  });

  it("leaves a plan without Revised unchanged", () => {
    expect(stripRevised(makePlan())).toBe(makePlan());
  });
});
