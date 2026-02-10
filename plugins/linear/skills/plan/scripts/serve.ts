#!/usr/bin/env bun

import { watch } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";
import { buildGraph, computeLayers } from "./graph";
import { loadPlan } from "./parse";
import { serializeIssue, serializeMilestone } from "./serialize";
import type { IssueFrontmatter, MilestoneFrontmatter } from "./types";
import { validatePlan } from "./validate";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface SSEClient {
  controller: ReadableStreamDefaultController;
}

function randomPort(): number {
  return 49152 + Math.floor(Math.random() * 16384);
}

export function createServer(planDir: string, port: number, shouldOpen: boolean) {
  const sseClients = new Set<SSEClient>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const htmlPath = join(import.meta.dirname, "..", "templates", "viz.html");
  const htmlFile = Bun.file(htmlPath);

  const watcher = watch(planDir, { recursive: true }, (_event, filename) => {
    if (filename && !filename.startsWith(".sync-state")) {
      broadcast(sseClients, "reload");
    }
  });

  function resetIdleTimer(server: { stop(): void }) {
    if (idleTimer) clearTimeout(idleTimer);
    if (sseClients.size === 0) {
      idleTimer = setTimeout(() => {
        console.log("No active connections. Shutting down.");
        watcher.close();
        server.stop();
      }, IDLE_TIMEOUT_MS);
    }
  }

  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: port || randomPort(),
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const { pathname } = url;
      const method = req.method;

      if (pathname === "/" && method === "GET") {
        return new Response(htmlFile, {
          headers: { "content-type": "text/html" },
        });
      }

      if (pathname === "/api/plan" && method === "GET") {
        return handleGetPlan(planDir);
      }

      if (pathname === "/events" && method === "GET") {
        return handleSSE(sseClients, server, resetIdleTimer);
      }

      const issueMatch = pathname.match(/^\/api\/issues\/(.+)$/);
      const milestoneMatch = pathname.match(/^\/api\/milestones\/(.+)$/);

      if (pathname === "/api/issues" && method === "POST") {
        return handleCreateIssue(planDir, req);
      }

      if (pathname === "/api/milestones" && method === "POST") {
        return handleCreateMilestone(planDir, req);
      }

      if (issueMatch?.[1]) {
        const filename = decodeURIComponent(issueMatch[1]);
        if (method === "PUT") return handleUpdateIssue(planDir, filename, req);
        if (method === "DELETE") return handleDeleteIssue(planDir, filename);
      }

      if (milestoneMatch?.[1]) {
        const filename = decodeURIComponent(milestoneMatch[1]);
        if (method === "PUT") return handleUpdateMilestone(planDir, filename, req);
      }

      return new Response("Not found", { status: 404 });
    },
  });

  resetIdleTimer(server);

  if (shouldOpen) {
    Bun.spawn(["open", `http://localhost:${server.port}`]);
  }

  return server;
}

async function handleGetPlan(planDir: string): Promise<Response> {
  try {
    const plan = await loadPlan(planDir);
    const errors = validatePlan(plan);
    const graph = buildGraph(plan.issues);
    const layerMap = computeLayers(graph);
    const layers: Record<string, number> = Object.fromEntries(layerMap);

    return Response.json({ plan, errors, layers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function handleSSE(
  clients: Set<SSEClient>,
  server: { stop(): void },
  resetIdleTimer: (server: { stop(): void }) => void,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const client: SSEClient = { controller };
      clients.add(client);
      resetIdleTimer(server);
    },
    cancel() {
      resetIdleTimer(server);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function broadcast(clients: Set<SSEClient>, event: string) {
  const data = `event: ${event}\ndata: {}\n\n`;
  for (const client of clients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(data));
    } catch {
      clients.delete(client);
    }
  }
}

async function handleCreateIssue(planDir: string, req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      filename: string;
      frontmatter: IssueFrontmatter;
      body: string;
    };
    const content = serializeIssue({
      filename: body.filename,
      frontmatter: body.frontmatter,
      body: body.body,
    });
    await writeFile(join(planDir, "issues", body.filename), content);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

async function handleCreateMilestone(planDir: string, req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      filename: string;
      frontmatter: MilestoneFrontmatter;
      body: string;
    };
    const content = serializeMilestone({
      filename: body.filename,
      frontmatter: body.frontmatter,
      body: body.body,
    });
    await writeFile(join(planDir, "issues", "milestones", body.filename), content);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

async function handleUpdateIssue(
  planDir: string,
  filename: string,
  req: Request,
): Promise<Response> {
  try {
    const body = (await req.json()) as {
      frontmatter: IssueFrontmatter;
      body: string;
    };
    const content = serializeIssue({ filename, frontmatter: body.frontmatter, body: body.body });
    await writeFile(join(planDir, "issues", filename), content);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

async function handleUpdateMilestone(
  planDir: string,
  filename: string,
  req: Request,
): Promise<Response> {
  try {
    const body = (await req.json()) as {
      frontmatter: MilestoneFrontmatter;
      body: string;
    };
    const content = serializeMilestone({
      filename,
      frontmatter: body.frontmatter,
      body: body.body,
    });
    await writeFile(join(planDir, "issues", "milestones", filename), content);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

async function handleDeleteIssue(planDir: string, filename: string): Promise<Response> {
  try {
    await unlink(join(planDir, "issues", filename));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

async function main() {
  const argv = cli({
    name: "serve",
    parameters: ["<plan-dir>"],
    flags: {
      port: {
        type: Number,
        description: "Port to listen on (0 for random)",
        default: 0,
      },
      open: {
        type: Boolean,
        description: "Open browser automatically",
        default: true,
      },
    },
    help: {
      description: "Serve plan visualization",
    },
  });

  const planDir = argv._.planDir;
  const server = createServer(planDir, argv.flags.port, argv.flags.open);
  console.log(`Serving plan at http://localhost:${server.port}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
