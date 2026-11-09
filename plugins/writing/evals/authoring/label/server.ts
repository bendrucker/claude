#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import {
  Feedback,
  feedbackEndpoint,
  fileResponse,
} from "../../../../../packages/eval-corpus/label";
import { Label, Pair } from "../scripts/pairs";

// Two modes share one server and one index.html: draft mode (--data) reviews
// single (input, output) drafts, and pairs mode (--pairs) runs blind A/B/tie
// review over Pair records.

const html = join(import.meta.dir, "index.html");
const align = join(import.meta.dir, "align.ts");

/** Deterministic left/right screen assignment from the pair id, stable across reloads. */
export function computeLeft(id: string): "a" | "b" {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum % 2 === 0 ? "a" : "b";
}

/** Round-robins pairs across surfaces so a labeling sitting sees variety instead of a run of one surface. */
export function interleaveBySurface<T extends { surface: string }>(pairs: T[]): T[] {
  const bySurface = new Map<string, T[]>();
  for (const p of pairs) {
    const bucket = bySurface.get(p.surface);
    if (bucket) bucket.push(p);
    else bySurface.set(p.surface, [p]);
  }
  const buckets = [...bySurface.values()];
  const out: T[] = [];
  for (let filled = true; filled;) {
    filled = false;
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next) {
        out.push(next);
        filled = true;
      }
    }
  }
  return out;
}

/** A Pair with `source` stripped from both drafts, plus the screen side assignment. Never send `source` to the browser. */
async function loadPairs(dir: string) {
  const names = await readdir(dir);
  const pairs = await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map(async (n) => Pair.parse(await Bun.file(join(dir, n)).json())),
  );
  return interleaveBySurface(pairs).map((p) => ({
    id: p.id,
    case: p.case,
    surface: p.surface,
    brief: p.brief,
    left: computeLeft(p.id),
    a: { text: p.a.text },
    b: { text: p.b.text },
  }));
}

export interface ServerOptions {
  dataPath: string;
  pairsDir?: string | undefined;
  feedbackDir: string;
}

export function createHandler(opts: ServerOptions): (req: Request) => Promise<Response> {
  const feedback = feedbackEndpoint(opts.feedbackDir, Feedback, (body) => body.feedback);
  const labels = feedbackEndpoint(opts.feedbackDir, Label);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return fileResponse(html, "text/html; charset=utf-8");
    }

    if (url.pathname === "/align.js") {
      const build = await Bun.build({ entrypoints: [align], target: "browser", format: "esm" });
      const [bundle] = build.outputs;
      if (!build.success || !bundle)
        throw new AggregateError(build.logs, "bundling align.ts failed");
      return new Response(await bundle.text(), {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/mode") {
      return Response.json({ mode: opts.pairsDir !== undefined ? "pairs" : "draft" });
    }

    if (opts.pairsDir !== undefined) {
      const pairsDir = opts.pairsDir;

      if (url.pathname === "/api/pairs" && req.method === "GET") {
        return Response.json(await loadPairs(pairsDir));
      }

      if (url.pathname === "/api/labels" && req.method === "GET") return labels.get();
      if (url.pathname === "/api/labels" && req.method === "POST") return labels.post(req);
    } else {
      if (url.pathname === "/api/samples") return fileResponse(opts.dataPath, "application/json");
      if (url.pathname === "/api/feedback" && req.method === "GET") return feedback.get();
      if (url.pathname === "/api/feedback" && req.method === "POST") return feedback.post(req);
    }

    return new Response("not found", { status: 404 });
  };
}

function port(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

export const program = new Command("label-server")
  .option("--port <n>", "Port to listen on", port, 4320)
  .option(
    "--data <path>",
    "Assembled single-draft samples to review",
    `${import.meta.dir}/../data/samples.json`,
  )
  .option("--pairs <dir>", "Directory of Pair json files: switches the server to pairwise mode")
  .option("--feedback <dir>", "Directory for saved feedback", `${import.meta.dir}/../feedback`)
  .action(async (options) => {
    await mkdir(options.feedback, { recursive: true });

    const server = Bun.serve({
      port: options.port,
      fetch: createHandler({
        dataPath: options.data,
        pairsDir: options.pairs,
        feedbackDir: options.feedback,
      }),
    });

    console.log(`Labeling UI: http://localhost:${server.port}`);
    console.log(`Mode:        ${options.pairs !== undefined ? "pairs" : "draft"}`);
    console.log(`Source:      ${options.pairs ?? options.data}`);
    console.log(`Feedback:    ${options.feedback}/`);
  });

if (import.meta.main) {
  await program.parseAsync();
}
