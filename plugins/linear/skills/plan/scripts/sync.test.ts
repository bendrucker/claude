import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient, SyncState } from "./sync";
import { loadSyncState, saveSyncState, sync } from "./sync";
import type { Plan, PlanIssue, PlanMilestone } from "./types";

function makePlan(dir: string, issues: PlanIssue[] = [], milestones: PlanMilestone[] = []): Plan {
  return {
    name: "test-plan",
    path: dir,
    spec: "# Test Plan",
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

function mockClient(overrides: Partial<LinearClient> = {}): LinearClient & {
  calls: { method: string; input: unknown }[];
} {
  const calls: { method: string; input: unknown }[] = [];
  let issueCounter = 0;
  let milestoneCounter = 0;
  let projectCounter = 0;

  return {
    calls,
    createProject:
      overrides.createProject ??
      (async (input) => {
        calls.push({ method: "createProject", input });
        return { id: `proj-${++projectCounter}` };
      }),
    createMilestone:
      overrides.createMilestone ??
      (async (input) => {
        calls.push({ method: "createMilestone", input });
        return { id: `ms-${++milestoneCounter}` };
      }),
    createIssue:
      overrides.createIssue ??
      (async (input) => {
        calls.push({ method: "createIssue", input });
        return { id: `issue-${++issueCounter}` };
      }),
    createRelation:
      overrides.createRelation ??
      (async (input) => {
        calls.push({ method: "createRelation", input });
      }),
  };
}

describe("sync", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `sync-test-${Date.now()}`);
  });

  afterEach(async () => {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true });
    }
  });

  it("creates issues in topological order", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const plan = makePlan(dir, [
      makeIssue("api.md", { blocked_by: ["auth.md"] }),
      makeIssue("auth.md"),
    ]);

    const result = await sync(plan, client, { teamId: "ENG" });

    expect(result.created.issues).toEqual(["auth.md", "api.md"]);
    const issueCalls = client.calls.filter((c) => c.method === "createIssue");
    expect(issueCalls).toHaveLength(2);
    expect((issueCalls[0]?.input as { title: string }).title).toBe("auth");
    expect((issueCalls[1]?.input as { title: string }).title).toBe("api");
  });

  it("creates blocking relations", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const plan = makePlan(dir, [makeIssue("auth.md", { blocks: ["api.md"] }), makeIssue("api.md")]);

    const result = await sync(plan, client, { teamId: "ENG" });

    expect(result.relations).toBe(1);
    const relationCalls = client.calls.filter((c) => c.method === "createRelation");
    expect(relationCalls).toHaveLength(1);
    expect(relationCalls[0]?.input).toEqual({
      issueId: "issue-1",
      relatedIssueId: "issue-2",
      type: "blocks",
    });
  });

  it("creates project when --create-project is set", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const plan = makePlan(dir, [makeIssue("a.md")]);

    const result = await sync(plan, client, { teamId: "ENG", createProject: true });

    expect(result.created.project).toBe(true);
    const projectCalls = client.calls.filter((c) => c.method === "createProject");
    expect(projectCalls).toHaveLength(1);
    expect((projectCalls[0]?.input as { name: string }).name).toBe("test-plan");
  });

  it("creates milestones as project milestones", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const plan = makePlan(
      dir,
      [makeIssue("a.md", { milestone: "v1.md" })],
      [makeMilestone("v1.md", { issues: ["a.md"] })],
    );

    await sync(plan, client, { teamId: "ENG", createProject: true });

    const milestoneCalls = client.calls.filter((c) => c.method === "createMilestone");
    expect(milestoneCalls).toHaveLength(1);
    expect((milestoneCalls[0]?.input as { name: string }).name).toBe("v1");

    const issueCalls = client.calls.filter((c) => c.method === "createIssue");
    expect((issueCalls[0]?.input as { projectMilestoneId: string }).projectMilestoneId).toBe(
      "ms-1",
    );
  });

  it("writes .sync-state.json after sync", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const plan = makePlan(dir, [makeIssue("a.md")]);

    await sync(plan, client, { teamId: "ENG" });

    const state = await loadSyncState(dir);
    expect(state.issues["a.md"]).toBe("issue-1");
  });

  it("skips existing issues on re-run", async () => {
    await mkdir(dir, { recursive: true });
    const state: SyncState = { milestones: {}, issues: { "a.md": "existing-1" } };
    await saveSyncState(dir, state);

    const client = mockClient();
    const plan = makePlan(dir, [makeIssue("a.md"), makeIssue("b.md")]);

    const result = await sync(plan, client, { teamId: "ENG" });

    expect(result.skipped.issues).toEqual(["a.md"]);
    expect(result.created.issues).toEqual(["b.md"]);
    const issueCalls = client.calls.filter((c) => c.method === "createIssue");
    expect(issueCalls).toHaveLength(1);
  });

  it("skips existing milestones on re-run", async () => {
    await mkdir(dir, { recursive: true });
    const state: SyncState = { milestones: { "v1.md": "ms-existing" }, issues: {} };
    await saveSyncState(dir, state);

    const client = mockClient();
    const plan = makePlan(dir, [], [makeMilestone("v1.md"), makeMilestone("v2.md")]);

    const result = await sync(plan, client, { teamId: "ENG", projectId: "proj-1" });

    expect(result.skipped.milestones).toEqual(["v1.md"]);
    expect(result.created.milestones).toEqual(["v2.md"]);
  });

  it("dry-run previews without creating", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const plan = makePlan(dir, [makeIssue("auth.md", { blocks: ["api.md"] }), makeIssue("api.md")]);

    const result = await sync(plan, client, { teamId: "ENG", dryRun: true });

    expect(result.created.issues).toEqual(["auth.md", "api.md"]);
    expect(result.relations).toBe(1);
    expect(client.calls).toHaveLength(0);
    expect(existsSync(join(dir, ".sync-state.json"))).toBe(false);
  });

  it("throws on invalid plan", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const issue: PlanIssue = { filename: "bad.md", frontmatter: { title: "" }, body: "" };
    const plan = makePlan(dir, [issue]);

    expect(sync(plan, client, { teamId: "ENG" })).rejects.toThrow("Plan validation failed");
  });

  it("uses existing project from sync state", async () => {
    await mkdir(dir, { recursive: true });
    const state: SyncState = { project: "proj-saved", milestones: {}, issues: {} };
    await saveSyncState(dir, state);

    const client = mockClient();
    const plan = makePlan(dir, [makeIssue("a.md")]);

    await sync(plan, client, { teamId: "ENG" });

    const issueCalls = client.calls.filter((c) => c.method === "createIssue");
    expect((issueCalls[0]?.input as { projectId: string }).projectId).toBe("proj-saved");
  });

  it("passes issue fields to Linear client", async () => {
    await mkdir(dir, { recursive: true });
    const client = mockClient();
    const plan = makePlan(dir, [
      makeIssue("a.md", {
        priority: 2,
        label: "bug",
        estimate: 3,
        assignee: "me",
      }),
    ]);

    await sync(plan, client, { teamId: "ENG", projectId: "proj-1" });

    const issueCalls = client.calls.filter((c) => c.method === "createIssue");
    const input = issueCalls[0]?.input as Record<string, unknown>;
    expect(input.priority).toBe(2);
    expect(input.labelName).toBe("bug");
    expect(input.estimate).toBe(3);
    expect(input.assignee).toBe("me");
    expect(input.projectId).toBe("proj-1");
  });
});

describe("loadSyncState", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `sync-state-test-${Date.now()}`);
  });

  afterEach(async () => {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true });
    }
  });

  it("returns empty state when file does not exist", async () => {
    const state = await loadSyncState(dir);
    expect(state).toEqual({ milestones: {}, issues: {} });
  });

  it("reads existing state", async () => {
    await mkdir(dir, { recursive: true });
    const expected: SyncState = {
      project: "proj-1",
      milestones: { "v1.md": "ms-1" },
      issues: { "a.md": "issue-1" },
    };
    await saveSyncState(dir, expected);

    const state = await loadSyncState(dir);
    expect(state).toEqual(expected);
  });
});
