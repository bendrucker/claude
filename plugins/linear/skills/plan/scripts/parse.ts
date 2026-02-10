import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import matter from "gray-matter";
import type {
  IssueFrontmatter,
  MilestoneFrontmatter,
  Plan,
  PlanIssue,
  PlanMilestone,
} from "./types";

export function parseIssueFrontmatter(content: string): {
  frontmatter: IssueFrontmatter;
  body: string;
} {
  const { data, content: body } = matter(content);
  return {
    frontmatter: data as IssueFrontmatter,
    body: body.trim(),
  };
}

export function parseMilestoneFrontmatter(content: string): {
  frontmatter: MilestoneFrontmatter;
  body: string;
} {
  const { data, content: body } = matter(content);
  return {
    frontmatter: data as MilestoneFrontmatter,
    body: body.trim(),
  };
}

export async function loadPlan(dirPath: string): Promise<Plan> {
  const name = basename(dirPath).replace(/^linear-plan-/, "");
  const issuesDir = join(dirPath, "issues");
  const milestonesDir = join(dirPath, "issues", "milestones");

  const specFile = await findSpec(dirPath);
  const spec = await readFile(join(dirPath, specFile), "utf-8");

  const issues = await loadIssues(issuesDir);
  const milestones = await loadMilestones(milestonesDir);

  return { name, path: dirPath, spec, issues, milestones };
}

async function findSpec(dirPath: string): Promise<string> {
  const entries = await readdir(dirPath);
  const mdFiles = entries.filter((f) => f.endsWith(".md") && f !== "README.md");
  const first = mdFiles[0];
  if (!first) {
    throw new Error(`No spec file found in ${dirPath}`);
  }
  return first;
}

async function loadIssues(issuesDir: string): Promise<PlanIssue[]> {
  let entries: string[];
  try {
    entries = await readdir(issuesDir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md"));

  const issues: PlanIssue[] = [];
  for (const file of mdFiles) {
    const content = await readFile(join(issuesDir, file), "utf-8");
    const { frontmatter, body } = parseIssueFrontmatter(content);
    issues.push({ filename: file, frontmatter, body });
  }
  return issues;
}

async function loadMilestones(milestonesDir: string): Promise<PlanMilestone[]> {
  let entries: string[];
  try {
    entries = await readdir(milestonesDir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md"));

  const milestones: PlanMilestone[] = [];
  for (const file of mdFiles) {
    const content = await readFile(join(milestonesDir, file), "utf-8");
    const { frontmatter, body } = parseMilestoneFrontmatter(content);
    milestones.push({ filename: file, frontmatter, body });
  }
  return milestones;
}
