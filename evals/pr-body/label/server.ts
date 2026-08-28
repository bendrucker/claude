#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";

const Feedback = z.looseObject({ id: z.string().regex(/^[\w-]+$/), feedback: z.unknown() });

// Local labeling server. Serves the review UI, hands the browser the mined samples, and persists
// reviewer feedback to feedback/<id>.json so a later analysis pass can read it back off disk.

const argv = cli({
  name: "label-server",
  flags: {
    port: { type: Number, default: 4319, description: "Port to listen on" },
    data: {
      type: String,
      default: join(import.meta.dirname, "..", "data", "samples.json"),
      description: "Mined samples to review",
    },
    feedback: {
      type: String,
      default: join(import.meta.dirname, "..", "feedback"),
      description: "Directory for saved feedback",
    },
  },
});

const html = join(import.meta.dirname, "index.html");

async function readAllFeedback(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let names: string[] = [];
  try {
    names = await readdir(argv.flags.feedback);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      out[n.replace(/\.json$/, "")] = await Bun.file(join(argv.flags.feedback, n)).json();
    } catch {}
  }
  return out;
}

const server = Bun.serve({
  port: argv.flags.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(html), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/samples") {
      return new Response(Bun.file(argv.flags.data), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/feedback" && req.method === "GET") {
      return Response.json(await readAllFeedback());
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      const body = Feedback.safeParse(await req.json());
      if (!body.success) return new Response(z.prettifyError(body.error), { status: 400 });
      const path = join(argv.flags.feedback, `${body.data.id}.json`);
      await Bun.write(path, JSON.stringify(body.data.feedback, null, 2));
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`Labeling UI: http://localhost:${server.port}`);
console.log(`Samples:     ${argv.flags.data}`);
console.log(`Feedback:    ${argv.flags.feedback}/`);
