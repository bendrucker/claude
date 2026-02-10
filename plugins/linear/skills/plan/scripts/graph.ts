import { basename } from "node:path";
import type { DependencyEdge, DependencyGraph, PlanIssue } from "./types";

function resolveRef(ref: string): string {
  return basename(ref);
}

export function buildGraph(issues: PlanIssue[]): DependencyGraph {
  const filenames = new Set(issues.map((i) => i.filename));
  const edges: DependencyEdge[] = [];

  for (const issue of issues) {
    const { blocks, blocked_by } = issue.frontmatter;

    if (blocks) {
      for (const target of blocks) {
        const resolved = resolveRef(target);
        if (filenames.has(resolved)) {
          edges.push({ from: issue.filename, to: resolved });
        }
      }
    }

    if (blocked_by) {
      for (const blocker of blocked_by) {
        const resolved = resolveRef(blocker);
        if (filenames.has(resolved)) {
          edges.push({ from: resolved, to: issue.filename });
        }
      }
    }
  }

  const uniqueEdges = deduplicateEdges(edges);
  const hasIncoming = new Set(uniqueEdges.map((e) => e.to));
  const hasOutgoing = new Set(uniqueEdges.map((e) => e.from));
  const nodes = [...filenames];

  return {
    nodes,
    edges: uniqueEdges,
    roots: nodes.filter((n) => !hasIncoming.has(n)),
    leaves: nodes.filter((n) => !hasOutgoing.has(n)),
  };
}

function deduplicateEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const seen = new Set<string>();
  const result: DependencyEdge[] = [];

  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }

  return result;
}

function buildAdjacency(graph: DependencyGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adj.set(node, []);
  }
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push(edge.to);
  }
  return adj;
}

export function topologicalSort(graph: DependencyGraph): string[] | null {
  const inDegree = new Map<string, number>();
  const adjacency = buildAdjacency(graph);

  for (const node of graph.nodes) {
    inDegree.set(node, 0);
  }

  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = graph.nodes.filter((n) => inDegree.get(n) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    result.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== graph.nodes.length) {
    return null;
  }

  return result;
}

export function detectCycles(graph: DependencyGraph): string[][] {
  const adjacency = buildAdjacency(graph);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  for (const node of graph.nodes) {
    color.set(node, WHITE);
  }

  const cycles: string[][] = [];
  const path: string[] = [];

  function dfs(node: string): void {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (color.get(neighbor) === GRAY) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push(path.slice(cycleStart));
      } else if (color.get(neighbor) === WHITE) {
        dfs(neighbor);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const node of graph.nodes) {
    if (color.get(node) === WHITE) {
      dfs(node);
    }
  }

  return cycles;
}

export function computeLayers(graph: DependencyGraph): Map<string, number> {
  const adjacency = buildAdjacency(graph);

  const layers = new Map<string, number>();
  for (const node of graph.nodes) {
    layers.set(node, 0);
  }

  const sorted = topologicalSort(graph);
  if (!sorted) return layers;

  for (const node of sorted) {
    for (const neighbor of adjacency.get(node) ?? []) {
      const candidateLayer = (layers.get(node) ?? 0) + 1;
      if (candidateLayer > (layers.get(neighbor) ?? 0)) {
        layers.set(neighbor, candidateLayer);
      }
    }
  }

  return layers;
}
