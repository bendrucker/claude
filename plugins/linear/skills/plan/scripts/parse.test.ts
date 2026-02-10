import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, parseIssueFrontmatter, parseMilestoneFrontmatter } from "./parse";

describe("parseIssueFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
title: Fix login bug
priority: 1
label: bug
---

Fix the authentication flow.`;

    const result = parseIssueFrontmatter(content);
    expect(result.frontmatter.title).toBe("Fix login bug");
    expect(result.frontmatter.priority).toBe(1);
    expect(result.frontmatter.label).toBe("bug");
    expect(result.body).toBe("Fix the authentication flow.");
  });

  it("parses blocks and blocked_by as arrays", () => {
    const content = `---
title: Deploy service
blocks:
  - monitoring.md
blocked_by:
  - build.md
  - test.md
---

Deploy the service.`;

    const result = parseIssueFrontmatter(content);
    expect(result.frontmatter.blocks).toEqual(["monitoring.md"]);
    expect(result.frontmatter.blocked_by).toEqual(["build.md", "test.md"]);
  });

  it("parses milestone reference", () => {
    const content = `---
title: Add API endpoint
milestone: milestones/v1.md
---

New endpoint.`;

    const result = parseIssueFrontmatter(content);
    expect(result.frontmatter.milestone).toBe("milestones/v1.md");
  });

  it("handles missing optional fields", () => {
    const content = `---
title: Simple task
---

Do the thing.`;

    const result = parseIssueFrontmatter(content);
    expect(result.frontmatter.title).toBe("Simple task");
    expect(result.frontmatter.priority).toBeUndefined();
    expect(result.frontmatter.label).toBeUndefined();
    expect(result.frontmatter.milestone).toBeUndefined();
    expect(result.frontmatter.blocks).toBeUndefined();
    expect(result.frontmatter.blocked_by).toBeUndefined();
  });

  it("trims body whitespace", () => {
    const content = `---
title: Task
---

  Body with leading spaces.

`;

    const result = parseIssueFrontmatter(content);
    expect(result.body).toBe("Body with leading spaces.");
  });
});

describe("parseMilestoneFrontmatter", () => {
  it("parses milestone with issues list", () => {
    const content = `---
title: Version 1.0
description: First release
issues:
  - auth.md
  - api.md
---

Release notes.`;

    const result = parseMilestoneFrontmatter(content);
    expect(result.frontmatter.title).toBe("Version 1.0");
    expect(result.frontmatter.description).toBe("First release");
    expect(result.frontmatter.issues).toEqual(["auth.md", "api.md"]);
    expect(result.body).toBe("Release notes.");
  });

  it("handles milestone with no issues", () => {
    const content = `---
title: Future Work
---

Placeholder.`;

    const result = parseMilestoneFrontmatter(content);
    expect(result.frontmatter.title).toBe("Future Work");
    expect(result.frontmatter.issues).toBeUndefined();
  });
});

describe("loadPlan", () => {
  let planDir: string;

  beforeEach(async () => {
    planDir = await mkdtemp(join(tmpdir(), "linear-plan-test-"));
    await mkdir(join(planDir, "issues", "milestones"), { recursive: true });
  });

  afterEach(async () => {
    await rm(planDir, { recursive: true });
  });

  it("loads a complete plan", async () => {
    await writeFile(join(planDir, "project.md"), "# Project\n\nSpec content.");
    await writeFile(
      join(planDir, "issues", "auth.md"),
      "---\ntitle: Auth\npriority: 1\n---\n\nAuth body.",
    );
    await writeFile(
      join(planDir, "issues", "milestones", "v1.md"),
      "---\ntitle: V1\n---\n\nV1 body.",
    );

    const plan = await loadPlan(planDir);
    expect(plan.spec).toBe("# Project\n\nSpec content.");
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]?.frontmatter.title).toBe("Auth");
    expect(plan.milestones).toHaveLength(1);
    expect(plan.milestones[0]?.frontmatter.title).toBe("V1");
  });

  it("extracts plan name from directory", async () => {
    const namedDir = await mkdtemp(join(tmpdir(), "linear-plan-"));
    await mkdir(join(namedDir, "issues", "milestones"), { recursive: true });
    await writeFile(join(namedDir, "spec.md"), "# Spec");

    const plan = await loadPlan(namedDir);
    expect(plan.name).toBeTruthy();
    expect(plan.path).toBe(namedDir);

    await rm(namedDir, { recursive: true });
  });

  it("handles empty issues directory", async () => {
    await writeFile(join(planDir, "spec.md"), "# Spec");

    const plan = await loadPlan(planDir);
    expect(plan.issues).toHaveLength(0);
    expect(plan.milestones).toHaveLength(0);
  });

  it("throws when no spec file exists", async () => {
    expect(loadPlan(planDir)).rejects.toThrow("No spec file found");
  });
});
