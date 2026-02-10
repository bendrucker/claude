import matter from "gray-matter";
import type { PlanIssue, PlanMilestone } from "./types";

export function serializeIssue(issue: PlanIssue): string {
  return matter.stringify(`\n${issue.body}\n`, issue.frontmatter);
}

export function serializeMilestone(milestone: PlanMilestone): string {
  return matter.stringify(`\n${milestone.body}\n`, milestone.frontmatter);
}
