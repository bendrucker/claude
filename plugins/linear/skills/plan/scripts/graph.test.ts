import { describe, expect, it } from "bun:test";
import { buildGraph, computeLayers, detectCycles, topologicalSort } from "./graph";
import type { PlanIssue } from "./types";

function issue(
  filename: string,
  deps: { blocks?: string[]; blocked_by?: string[] } = {},
): PlanIssue {
  return {
    filename,
    frontmatter: { title: filename, ...deps },
    body: "",
  };
}

describe("buildGraph", () => {
  it("builds edges from blocks", () => {
    const graph = buildGraph([issue("a.md", { blocks: ["b.md"] }), issue("b.md")]);

    expect(graph.nodes).toEqual(["a.md", "b.md"]);
    expect(graph.edges).toEqual([{ from: "a.md", to: "b.md" }]);
    expect(graph.roots).toEqual(["a.md"]);
    expect(graph.leaves).toEqual(["b.md"]);
  });

  it("builds edges from blocked_by", () => {
    const graph = buildGraph([issue("a.md"), issue("b.md", { blocked_by: ["a.md"] })]);

    expect(graph.edges).toEqual([{ from: "a.md", to: "b.md" }]);
    expect(graph.roots).toEqual(["a.md"]);
    expect(graph.leaves).toEqual(["b.md"]);
  });

  it("deduplicates edges from blocks and blocked_by", () => {
    const graph = buildGraph([
      issue("a.md", { blocks: ["b.md"] }),
      issue("b.md", { blocked_by: ["a.md"] }),
    ]);

    expect(graph.edges).toEqual([{ from: "a.md", to: "b.md" }]);
  });

  it("ignores references to unknown files", () => {
    const graph = buildGraph([issue("a.md", { blocks: ["unknown.md"] })]);

    expect(graph.edges).toEqual([]);
    expect(graph.roots).toEqual(["a.md"]);
    expect(graph.leaves).toEqual(["a.md"]);
  });

  it("returns empty graph for no dependencies", () => {
    const graph = buildGraph([issue("a.md"), issue("b.md")]);

    expect(graph.nodes).toEqual(["a.md", "b.md"]);
    expect(graph.edges).toEqual([]);
    expect(graph.roots).toEqual(["a.md", "b.md"]);
    expect(graph.leaves).toEqual(["a.md", "b.md"]);
  });
});

describe("topologicalSort", () => {
  it("sorts a linear chain", () => {
    const graph = buildGraph([
      issue("a.md", { blocks: ["b.md"] }),
      issue("b.md", { blocks: ["c.md"] }),
      issue("c.md"),
    ]);

    expect(topologicalSort(graph)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("sorts a diamond DAG", () => {
    const graph = buildGraph([
      issue("a.md", { blocks: ["b.md", "c.md"] }),
      issue("b.md", { blocks: ["d.md"] }),
      issue("c.md", { blocks: ["d.md"] }),
      issue("d.md"),
    ]);

    const sorted = topologicalSort(graph);
    expect(sorted).not.toBeNull();
    expect(sorted?.indexOf("a.md")).toBeLessThan(sorted?.indexOf("b.md") ?? 0);
    expect(sorted?.indexOf("a.md")).toBeLessThan(sorted?.indexOf("c.md") ?? 0);
    expect(sorted?.indexOf("b.md")).toBeLessThan(sorted?.indexOf("d.md") ?? 0);
    expect(sorted?.indexOf("c.md")).toBeLessThan(sorted?.indexOf("d.md") ?? 0);
  });

  it("returns null for a cycle", () => {
    const graph: ReturnType<typeof buildGraph> = {
      nodes: ["a.md", "b.md"],
      edges: [
        { from: "a.md", to: "b.md" },
        { from: "b.md", to: "a.md" },
      ],
      roots: [],
      leaves: [],
    };

    expect(topologicalSort(graph)).toBeNull();
  });

  it("handles disconnected nodes", () => {
    const graph = buildGraph([issue("a.md"), issue("b.md")]);
    const sorted = topologicalSort(graph);

    expect(sorted).toHaveLength(2);
    expect(sorted).toContain("a.md");
    expect(sorted).toContain("b.md");
  });
});

describe("detectCycles", () => {
  it("returns empty array for acyclic graph", () => {
    const graph = buildGraph([issue("a.md", { blocks: ["b.md"] }), issue("b.md")]);

    expect(detectCycles(graph)).toEqual([]);
  });

  it("detects a simple cycle", () => {
    const graph = {
      nodes: ["a.md", "b.md"],
      edges: [
        { from: "a.md", to: "b.md" },
        { from: "b.md", to: "a.md" },
      ],
      roots: [],
      leaves: [],
    };

    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["a.md", "b.md"]);
  });

  it("detects a complex cycle", () => {
    const graph = {
      nodes: ["a.md", "b.md", "c.md", "d.md"],
      edges: [
        { from: "a.md", to: "b.md" },
        { from: "b.md", to: "c.md" },
        { from: "c.md", to: "a.md" },
        { from: "a.md", to: "d.md" },
      ],
      roots: [],
      leaves: ["d.md"],
    };

    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["a.md", "b.md", "c.md"]);
  });
});

describe("computeLayers", () => {
  it("assigns layers for a linear chain", () => {
    const graph = buildGraph([
      issue("a.md", { blocks: ["b.md"] }),
      issue("b.md", { blocks: ["c.md"] }),
      issue("c.md"),
    ]);

    const layers = computeLayers(graph);
    expect(layers.get("a.md")).toBe(0);
    expect(layers.get("b.md")).toBe(1);
    expect(layers.get("c.md")).toBe(2);
  });

  it("assigns layers for a diamond pattern", () => {
    const graph = buildGraph([
      issue("a.md", { blocks: ["b.md", "c.md"] }),
      issue("b.md", { blocks: ["d.md"] }),
      issue("c.md", { blocks: ["d.md"] }),
      issue("d.md"),
    ]);

    const layers = computeLayers(graph);
    expect(layers.get("a.md")).toBe(0);
    expect(layers.get("b.md")).toBe(1);
    expect(layers.get("c.md")).toBe(1);
    expect(layers.get("d.md")).toBe(2);
  });

  it("assigns layer 0 to disconnected nodes", () => {
    const graph = buildGraph([issue("a.md"), issue("b.md"), issue("c.md")]);

    const layers = computeLayers(graph);
    expect(layers.get("a.md")).toBe(0);
    expect(layers.get("b.md")).toBe(0);
    expect(layers.get("c.md")).toBe(0);
  });

  it("uses longest path for layer assignment", () => {
    const graph = buildGraph([
      issue("a.md", { blocks: ["c.md"] }),
      issue("b.md", { blocks: ["c.md"] }),
      issue("c.md"),
      issue("x.md", { blocks: ["b.md"] }),
    ]);

    const layers = computeLayers(graph);
    expect(layers.get("a.md")).toBe(0);
    expect(layers.get("x.md")).toBe(0);
    expect(layers.get("b.md")).toBe(1);
    expect(layers.get("c.md")).toBe(2);
  });
});
