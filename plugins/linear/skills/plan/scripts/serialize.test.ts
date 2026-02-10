import { describe, expect, it } from "bun:test";
import { parseIssueFrontmatter, parseMilestoneFrontmatter } from "./parse";
import { serializeIssue, serializeMilestone } from "./serialize";
import type { PlanIssue, PlanMilestone } from "./types";

describe("serializeIssue", () => {
  it("serializes an issue to frontmatter + body", () => {
    const issue: PlanIssue = {
      filename: "auth.md",
      frontmatter: {
        title: "Fix auth",
        priority: 1,
        label: "bug",
      },
      body: "Fix the authentication flow.",
    };

    const result = serializeIssue(issue);
    expect(result).toContain("title: Fix auth");
    expect(result).toContain("priority: 1");
    expect(result).toContain("label: bug");
    expect(result).toContain("Fix the authentication flow.");
  });

  it("round-trips through parse", () => {
    const issue: PlanIssue = {
      filename: "deploy.md",
      frontmatter: {
        title: "Deploy service",
        priority: 2,
        milestone: "milestones/v1.md",
        blocks: ["monitoring.md"],
        blocked_by: ["build.md", "test.md"],
      },
      body: "Deploy the service to production.",
    };

    const serialized = serializeIssue(issue);
    const parsed = parseIssueFrontmatter(serialized);
    expect(parsed.frontmatter).toEqual(issue.frontmatter);
    expect(parsed.body).toBe(issue.body);
  });

  it("handles issue with no optional fields", () => {
    const issue: PlanIssue = {
      filename: "task.md",
      frontmatter: { title: "Simple task" },
      body: "Do the thing.",
    };

    const serialized = serializeIssue(issue);
    const parsed = parseIssueFrontmatter(serialized);
    expect(parsed.frontmatter.title).toBe("Simple task");
    expect(parsed.body).toBe("Do the thing.");
  });
});

describe("serializeMilestone", () => {
  it("serializes a milestone to frontmatter + body", () => {
    const milestone: PlanMilestone = {
      filename: "v1.md",
      frontmatter: {
        title: "Version 1.0",
        description: "First release",
        issues: ["auth.md", "api.md"],
      },
      body: "Release notes.",
    };

    const result = serializeMilestone(milestone);
    expect(result).toContain("title: Version 1.0");
    expect(result).toContain("description: First release");
    expect(result).toContain("Release notes.");
  });

  it("round-trips through parse", () => {
    const milestone: PlanMilestone = {
      filename: "v2.md",
      frontmatter: {
        title: "Version 2.0",
        issues: ["feature-a.md", "feature-b.md"],
      },
      body: "Second release.",
    };

    const serialized = serializeMilestone(milestone);
    const parsed = parseMilestoneFrontmatter(serialized);
    expect(parsed.frontmatter).toEqual(milestone.frontmatter);
    expect(parsed.body).toBe(milestone.body);
  });
});
