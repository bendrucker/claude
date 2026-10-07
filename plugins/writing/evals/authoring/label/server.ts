#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { z } from "zod";
import { Label, Pair } from "../scripts/pairs";

const Feedback = z.looseObject({ id: z.string().regex(/^[\w-]+$/), feedback: z.unknown() });

// Local labeling server. Serves the review UI and persists reviewer feedback
// to disk so a later analysis pass can read it back. Two modes share one
// server and one index.html:
//   - draft mode (--data): the original single-draft (input, output) review.
//   - pairs mode (--pairs): blind pairwise A/B/tie review over Pair records.

const html = join(import.meta.dir, "index.html");
const align = join(import.meta.dir, "align.ts");

async function readAllJson(dir: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map(async (n) => {
        try {
          out[n.replace(/\.json$/, "")] = await Bun.file(join(dir, n)).json();
        } catch {
          // best-effort: skip a file that fails to parse rather than blocking the rest
        }
      }),
  );
  return out;
}

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

export function createHandler(opts: ServerOptions) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(html), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
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

      if (url.pathname === "/api/labels" && req.method === "GET") {
        return Response.json(await readAllJson(opts.feedbackDir));
      }

      if (url.pathname === "/api/labels" && req.method === "POST") {
        const body = Label.safeParse(await req.json());
        if (!body.success) return new Response(z.prettifyError(body.error), { status: 400 });
        const path = join(opts.feedbackDir, `${body.data.id}.json`);
        await Bun.write(path, JSON.stringify(body.data, null, 2));
        return Response.json({ ok: true });
      }
    } else {
      if (url.pathname === "/api/samples") {
        return new Response(Bun.file(opts.dataPath), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/api/feedback" && req.method === "GET") {
        return Response.json(await readAllJson(opts.feedbackDir));
      }

      if (url.pathname === "/api/feedback" && req.method === "POST") {
        const body = Feedback.safeParse(await req.json());
        if (!body.success) return new Response(z.prettifyError(body.error), { status: 400 });
        const path = join(opts.feedbackDir, `${body.data.id}.json`);
        await Bun.write(path, JSON.stringify(body.data.feedback, null, 2));
        return Response.json({ ok: true });
      }
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
