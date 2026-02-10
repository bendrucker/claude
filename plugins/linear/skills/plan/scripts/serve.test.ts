import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./serve";

describe("serve", () => {
  let planDir: string;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    planDir = await mkdtemp(join(tmpdir(), "plan-serve-test-"));
    await mkdir(join(planDir, "issues", "milestones"), { recursive: true });
    await writeFile(join(planDir, "spec.md"), "# Test Plan\n\nSpec content.");
    await writeFile(
      join(planDir, "issues", "auth.md"),
      "---\ntitle: Auth\npriority: 1\n---\n\nAuth body.",
    );
    await writeFile(
      join(planDir, "issues", "milestones", "v1.md"),
      "---\ntitle: V1\n---\n\nV1 body.",
    );
    server = createServer(planDir, 0, false);
  });

  afterEach(async () => {
    server.stop();
    await rm(planDir, { recursive: true });
  });

  function url(path: string): string {
    return `http://localhost:${server.port}${path}`;
  }

  it("serves viz.html at /", async () => {
    const res = await fetch(url("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns plan data at /api/plan", async () => {
    const res = await fetch(url("/api/plan"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      plan: { issues: { filename: string }[] };
      errors: unknown[];
      layers: Record<string, number>;
    };
    expect(data.plan.issues).toHaveLength(1);
    expect(data.plan.issues[0]?.filename).toBe("auth.md");
    expect(data.errors).toEqual([]);
    expect(data.layers).toBeDefined();
  });

  it("creates an issue via POST /api/issues", async () => {
    const res = await fetch(url("/api/issues"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "new-issue.md",
        frontmatter: { title: "New Issue", priority: 2 },
        body: "New issue body.",
      }),
    });
    expect(res.status).toBe(201);

    const content = await readFile(join(planDir, "issues", "new-issue.md"), "utf-8");
    expect(content).toContain("title: New Issue");
    expect(content).toContain("New issue body.");
  });

  it("updates an issue via PUT /api/issues/:filename", async () => {
    const res = await fetch(url("/api/issues/auth.md"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        frontmatter: { title: "Updated Auth", priority: 2 },
        body: "Updated body.",
      }),
    });
    expect(res.status).toBe(200);

    const content = await readFile(join(planDir, "issues", "auth.md"), "utf-8");
    expect(content).toContain("title: Updated Auth");
    expect(content).toContain("Updated body.");
  });

  it("deletes an issue via DELETE /api/issues/:filename", async () => {
    const res = await fetch(url("/api/issues/auth.md"), { method: "DELETE" });
    expect(res.status).toBe(200);

    const exists = await Bun.file(join(planDir, "issues", "auth.md")).exists();
    expect(exists).toBe(false);
  });

  it("creates a milestone via POST /api/milestones", async () => {
    const res = await fetch(url("/api/milestones"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "v2.md",
        frontmatter: { title: "V2" },
        body: "V2 body.",
      }),
    });
    expect(res.status).toBe(201);

    const content = await readFile(join(planDir, "issues", "milestones", "v2.md"), "utf-8");
    expect(content).toContain("title: V2");
  });

  it("updates a milestone via PUT /api/milestones/:filename", async () => {
    const res = await fetch(url("/api/milestones/v1.md"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        frontmatter: { title: "Updated V1", description: "Updated" },
        body: "Updated body.",
      }),
    });
    expect(res.status).toBe(200);

    const content = await readFile(join(planDir, "issues", "milestones", "v1.md"), "utf-8");
    expect(content).toContain("title: Updated V1");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(url("/unknown"));
    expect(res.status).toBe(404);
  });

  it("returns SSE stream at /events", async () => {
    const res = await fetch(url("/events"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });
});
