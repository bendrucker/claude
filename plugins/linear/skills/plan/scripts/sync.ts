#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";
import { buildGraph, topologicalSort } from "./graph";
import { loadPlan } from "./parse";
import type { Plan, PlanIssue } from "./types";
import { validatePlan } from "./validate";

export interface SyncState {
  project?: string;
  milestones: Record<string, string>;
  issues: Record<string, string>;
}

export interface LinearClient {
  createProject(input: { name: string; teamId: string }): Promise<{ id: string }>;
  createMilestone(input: {
    name: string;
    projectId: string;
    description?: string;
  }): Promise<{ id: string }>;
  createIssue(input: {
    title: string;
    teamId: string;
    description?: string;
    priority?: number;
    labelName?: string;
    projectId?: string;
    projectMilestoneId?: string;
    estimate?: number;
    assignee?: string;
  }): Promise<{ id: string }>;
  createRelation(input: { issueId: string; relatedIssueId: string; type: "blocks" }): Promise<void>;
}

export async function loadSyncState(planDir: string): Promise<SyncState> {
  try {
    const content = await readFile(join(planDir, ".sync-state.json"), "utf-8");
    return JSON.parse(content) as SyncState;
  } catch {
    return { milestones: {}, issues: {} };
  }
}

export async function saveSyncState(planDir: string, state: SyncState): Promise<void> {
  await writeFile(join(planDir, ".sync-state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export interface SyncOptions {
  teamId: string;
  projectId?: string;
  createProject?: boolean;
  dryRun?: boolean;
}

export interface SyncResult {
  created: { issues: string[]; milestones: string[]; project: boolean };
  skipped: { issues: string[]; milestones: string[] };
  relations: number;
}

export async function sync(
  plan: Plan,
  client: LinearClient,
  options: SyncOptions,
): Promise<SyncResult> {
  const errors = validatePlan(plan);
  if (errors.length > 0) {
    const messages = errors.map((e) => `  ${e.file}: ${e.message}`).join("\n");
    throw new Error(`Plan validation failed:\n${messages}`);
  }

  const state = await loadSyncState(plan.path);
  const result: SyncResult = {
    created: { issues: [], milestones: [], project: false },
    skipped: { issues: [], milestones: [] },
    relations: 0,
  };

  const projectId = await resolveProject(plan, client, options, state, result);
  await syncMilestones(plan, client, projectId, state, result, options.dryRun);
  await syncIssues(plan, client, options.teamId, projectId, state, result, options.dryRun);
  await syncRelations(plan, client, state, result, options.dryRun);

  if (!options.dryRun) {
    await saveSyncState(plan.path, state);
  }

  return result;
}

async function resolveProject(
  plan: Plan,
  client: LinearClient,
  options: SyncOptions,
  state: SyncState,
  result: SyncResult,
): Promise<string | undefined> {
  if (options.projectId) {
    state.project = options.projectId;
    return options.projectId;
  }

  if (state.project) {
    return state.project;
  }

  if (options.createProject) {
    if (options.dryRun) {
      result.created.project = true;
      return undefined;
    }

    const project = await client.createProject({
      name: plan.name,
      teamId: options.teamId,
    });
    state.project = project.id;
    result.created.project = true;
    return project.id;
  }

  return undefined;
}

async function syncMilestones(
  plan: Plan,
  client: LinearClient,
  projectId: string | undefined,
  state: SyncState,
  result: SyncResult,
  dryRun?: boolean,
): Promise<void> {
  if (!projectId || plan.milestones.length === 0) return;

  for (const milestone of plan.milestones) {
    if (state.milestones[milestone.filename]) {
      result.skipped.milestones.push(milestone.filename);
      continue;
    }

    if (dryRun) {
      result.created.milestones.push(milestone.filename);
      continue;
    }

    const input: Parameters<LinearClient["createMilestone"]>[0] = {
      name: milestone.frontmatter.title,
      projectId,
    };
    if (milestone.body) input.description = milestone.body;
    const created = await client.createMilestone(input);
    state.milestones[milestone.filename] = created.id;
    result.created.milestones.push(milestone.filename);
  }
}

async function syncIssues(
  plan: Plan,
  client: LinearClient,
  teamId: string,
  projectId: string | undefined,
  state: SyncState,
  result: SyncResult,
  dryRun?: boolean,
): Promise<void> {
  const graph = buildGraph(plan.issues);
  const sorted = topologicalSort(graph);
  if (!sorted) {
    throw new Error("Cannot sync: dependency graph contains cycles");
  }

  const issueMap = new Map(plan.issues.map((i) => [i.filename, i]));

  for (const filename of sorted) {
    const issue = issueMap.get(filename);
    if (!issue) continue;

    if (state.issues[filename]) {
      result.skipped.issues.push(filename);
      continue;
    }

    if (dryRun) {
      result.created.issues.push(filename);
      continue;
    }

    const input: Parameters<LinearClient["createIssue"]>[0] = {
      title: issue.frontmatter.title,
      teamId,
    };
    if (issue.body) input.description = issue.body;
    if (issue.frontmatter.priority) input.priority = issue.frontmatter.priority;
    if (issue.frontmatter.label) input.labelName = issue.frontmatter.label;
    if (projectId) input.projectId = projectId;
    const milestoneId = resolveMilestoneId(issue, state);
    if (milestoneId) input.projectMilestoneId = milestoneId;
    if (issue.frontmatter.estimate) input.estimate = issue.frontmatter.estimate;
    if (issue.frontmatter.assignee) input.assignee = issue.frontmatter.assignee;
    const created = await client.createIssue(input);
    state.issues[filename] = created.id;
    result.created.issues.push(filename);
  }
}

function resolveMilestoneId(issue: PlanIssue, state: SyncState): string | undefined {
  if (!issue.frontmatter.milestone) return undefined;
  return state.milestones[issue.frontmatter.milestone];
}

async function syncRelations(
  plan: Plan,
  client: LinearClient,
  state: SyncState,
  result: SyncResult,
  dryRun?: boolean,
): Promise<void> {
  const graph = buildGraph(plan.issues);

  if (dryRun) {
    result.relations = graph.edges.length;
    return;
  }

  for (const edge of graph.edges) {
    const fromId = state.issues[edge.from];
    const toId = state.issues[edge.to];
    if (!fromId || !toId) continue;

    await client.createRelation({
      issueId: fromId,
      relatedIssueId: toId,
      type: "blocks",
    });
    result.relations++;
  }
}

function formatResult(result: SyncResult, dryRun: boolean): string {
  const prefix = dryRun ? "[dry-run] " : "";
  const lines: string[] = [];

  if (result.created.project) {
    lines.push(`${prefix}Create project`);
  }

  for (const m of result.created.milestones) {
    lines.push(`${prefix}Create milestone: ${m}`);
  }

  for (const i of result.created.issues) {
    lines.push(`${prefix}Create issue: ${i}`);
  }

  for (const m of result.skipped.milestones) {
    lines.push(`Skip milestone (exists): ${m}`);
  }

  for (const i of result.skipped.issues) {
    lines.push(`Skip issue (exists): ${i}`);
  }

  if (result.relations > 0) {
    lines.push(`${prefix}Create ${result.relations} relation(s)`);
  }

  return lines.join("\n");
}

async function main() {
  const argv = cli({
    name: "sync",
    parameters: ["<plan-dir>"],
    flags: {
      team: {
        type: String,
        description: "Linear team key (e.g. ENG)",
        alias: "t",
      },
      project: {
        type: String,
        description: "Existing Linear project ID",
      },
      createProject: {
        type: Boolean,
        description: "Create a new project for the plan",
        default: false,
      },
      dryRun: {
        type: Boolean,
        description: "Preview changes without syncing",
        default: false,
      },
    },
    help: {
      description: "Sync a Linear plan to Linear",
    },
  });

  if (!argv.flags.team) {
    console.error("Error: --team is required");
    process.exit(1);
  }

  const plan = await loadPlan(argv._.planDir);

  const options: SyncOptions = {
    teamId: argv.flags.team,
    createProject: argv.flags.createProject,
    dryRun: argv.flags.dryRun,
  };
  if (argv.flags.project) options.projectId = argv.flags.project;
  const result = await sync(plan, createMcpClient(), options);

  console.log(formatResult(result, argv.flags.dryRun));
}

function createMcpClient(): LinearClient {
  throw new Error("MCP client not available in direct execution. Use this script via Claude Code.");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
