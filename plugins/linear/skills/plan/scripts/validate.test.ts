import { describe, expect, it } from "bun:test";
import type { Plan, PlanIssue, PlanMilestone } from "./types";
import { validatePlan } from "./validate";

function makePlan(issues: PlanIssue[] = [], milestones: PlanMilestone[] = []): Plan {
  return {
    name: "test",
    path: "/tmp/test",
    spec: "# Test",
    issues,
    milestones,
  };
}

function makeIssue(filename: string, overrides: Partial<PlanIssue["frontmatter"]> = {}): PlanIssue {
  return {
    filename,
    frontmatter: { title: filename.replace(".md", ""), ...overrides },
    body: "",
  };
}

function makeMilestone(
  filename: string,
  overrides: Partial<PlanMilestone["frontmatter"]> = {},
): PlanMilestone {
  return {
    filename,
    frontmatter: { title: filename.replace(".md", ""), ...overrides },
    body: "",
  };
}

describe("validatePlan", () => {
  it("returns no errors for a valid plan", () => {
    const plan = makePlan(
      [
        makeIssue("auth.md", { milestone: "v1.md", priority: 1 }),
        makeIssue("api.md", {
          milestone: "v1.md",
          blocked_by: ["auth.md"],
          priority: 2,
        }),
      ],
      [makeMilestone("v1.md", { issues: ["auth.md", "api.md"] })],
    );
    expect(validatePlan(plan)).toEqual([]);
  });

  it("errors on missing title", () => {
    const issue: PlanIssue = {
      filename: "bad.md",
      frontmatter: { title: "" },
      body: "",
    };
    const errors = validatePlan(makePlan([issue]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("title");
  });

  it("errors on priority out of range", () => {
    const errors = validatePlan(makePlan([makeIssue("a.md", { priority: 5 })]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("priority");
    expect(errors[0]?.message).toContain("1-4");
  });

  it("allows valid priorities", () => {
    const issues = [1, 2, 3, 4].map((p) => makeIssue(`p${p}.md`, { priority: p }));
    expect(validatePlan(makePlan(issues))).toEqual([]);
  });

  it("errors on broken blocks reference", () => {
    const errors = validatePlan(makePlan([makeIssue("a.md", { blocks: ["nonexistent.md"] })]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("blocks");
    expect(errors[0]?.message).toContain("nonexistent.md");
  });

  it("errors on broken blocked_by reference", () => {
    const errors = validatePlan(makePlan([makeIssue("a.md", { blocked_by: ["missing.md"] })]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("blocked_by");
  });

  it("errors on broken milestone reference", () => {
    const errors = validatePlan(makePlan([makeIssue("a.md", { milestone: "missing.md" })]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("milestone");
  });

  it("errors on milestone listing nonexistent issue", () => {
    const errors = validatePlan(makePlan([], [makeMilestone("v1.md", { issues: ["ghost.md"] })]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("issues");
    expect(errors[0]?.message).toContain("ghost.md");
  });

  it("errors on milestone/issue bidirectional mismatch", () => {
    const errors = validatePlan(
      makePlan(
        [makeIssue("a.md", { milestone: "v2.md" })],
        [makeMilestone("v1.md", { issues: ["a.md"] }), makeMilestone("v2.md")],
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("v2.md");
  });

  it("errors on circular dependencies", () => {
    const errors = validatePlan(
      makePlan([makeIssue("a.md", { blocks: ["b.md"] }), makeIssue("b.md", { blocks: ["a.md"] })]),
    );
    const cycleErrors = errors.filter((e) => e.message.includes("Circular dependency"));
    expect(cycleErrors.length).toBeGreaterThan(0);
  });

  it("errors on missing milestone title", () => {
    const milestone: PlanMilestone = {
      filename: "bad.md",
      frontmatter: { title: "" },
      body: "",
    };
    const errors = validatePlan(makePlan([], [milestone]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("title");
  });

  it("returns no errors for empty plan", () => {
    expect(validatePlan(makePlan())).toEqual([]);
  });
});
