export interface IssueFrontmatter {
  title: string;
  label?: string;
  priority?: number;
  milestone?: string;
  blocks?: string[];
  blocked_by?: string[];
  estimate?: number;
  assignee?: string;
}

export interface MilestoneFrontmatter {
  title: string;
  description?: string;
  issues?: string[];
}

export interface PlanIssue {
  filename: string;
  frontmatter: IssueFrontmatter;
  body: string;
}

export interface PlanMilestone {
  filename: string;
  frontmatter: MilestoneFrontmatter;
  body: string;
}

export interface Plan {
  name: string;
  path: string;
  spec: string;
  issues: PlanIssue[];
  milestones: PlanMilestone[];
}

export interface ValidationError {
  file: string;
  field?: string;
  message: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface DependencyGraph {
  nodes: string[];
  edges: DependencyEdge[];
  roots: string[];
  leaves: string[];
}
