import { basename } from "node:path";
import { buildGraph, detectCycles } from "./graph";
import type { Plan, PlanIssue, ValidationError } from "./types";

function resolveRef(ref: string): string {
  return basename(ref);
}

export function validatePlan(plan: Plan): ValidationError[] {
  const errors: ValidationError[] = [];

  const issueFilenames = new Set(plan.issues.map((i) => i.filename));
  const milestoneFilenames = new Set(plan.milestones.map((m) => m.filename));

  for (const issue of plan.issues) {
    validateIssue(issue, issueFilenames, milestoneFilenames, errors);
  }

  validateMilestoneConsistency(plan, issueFilenames, errors);
  validateNoCycles(plan.issues, errors);

  return errors;
}

function validateIssue(
  issue: PlanIssue,
  issueFilenames: Set<string>,
  milestoneFilenames: Set<string>,
  errors: ValidationError[],
): void {
  const { frontmatter, filename } = issue;

  if (!frontmatter.title) {
    errors.push({ file: filename, field: "title", message: "Missing required field: title" });
  }

  if (
    frontmatter.priority !== undefined &&
    (frontmatter.priority < 1 || frontmatter.priority > 4)
  ) {
    errors.push({
      file: filename,
      field: "priority",
      message: `Priority must be 1-4, got ${frontmatter.priority}`,
    });
  }

  if (frontmatter.blocks) {
    for (const ref of frontmatter.blocks) {
      if (!issueFilenames.has(resolveRef(ref))) {
        errors.push({
          file: filename,
          field: "blocks",
          message: `References non-existent issue: ${ref}`,
        });
      }
    }
  }

  if (frontmatter.blocked_by) {
    for (const ref of frontmatter.blocked_by) {
      if (!issueFilenames.has(resolveRef(ref))) {
        errors.push({
          file: filename,
          field: "blocked_by",
          message: `References non-existent issue: ${ref}`,
        });
      }
    }
  }

  if (frontmatter.milestone && !milestoneFilenames.has(resolveRef(frontmatter.milestone))) {
    errors.push({
      file: filename,
      field: "milestone",
      message: `References non-existent milestone: ${frontmatter.milestone}`,
    });
  }
}

function validateMilestoneConsistency(
  plan: Plan,
  issueFilenames: Set<string>,
  errors: ValidationError[],
): void {
  for (const milestone of plan.milestones) {
    if (!milestone.frontmatter.title) {
      errors.push({
        file: milestone.filename,
        field: "title",
        message: "Missing required field: title",
      });
    }

    if (!milestone.frontmatter.issues) continue;

    for (const ref of milestone.frontmatter.issues) {
      const resolved = resolveRef(ref);
      if (!issueFilenames.has(resolved)) {
        errors.push({
          file: milestone.filename,
          field: "issues",
          message: `References non-existent issue: ${ref}`,
        });
        continue;
      }

      const issue = plan.issues.find((i) => i.filename === resolved);
      if (issue && resolveRef(issue.frontmatter.milestone ?? "") !== milestone.filename) {
        errors.push({
          file: milestone.filename,
          field: "issues",
          message: `Issue ${ref} lists milestone as "${issue.frontmatter.milestone ?? "(none)"}" but is listed in ${milestone.filename}`,
        });
      }
    }
  }
}

function validateNoCycles(issues: PlanIssue[], errors: ValidationError[]): void {
  const graph = buildGraph(issues);
  const cycles = detectCycles(graph);
  for (const cycle of cycles) {
    errors.push({
      file: cycle[0] ?? "unknown",
      message: `Circular dependency: ${cycle.join(" → ")}`,
    });
  }
}
