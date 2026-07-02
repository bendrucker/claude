#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";

// Local labeling server for review-voice candidates. Serves the UI, hands the
// browser the mined candidates, and persists each verdict to labels/<id>.json so
// report.ts can read them back off disk. Everything stays on this machine: the
// mined bodies include imported work-repo content that must not leave it.

const argv = cli({
  name: "label-server",
  flags: {
    port: { type: Number, default: 4318, description: "Port to listen on" },
    data: {
      type: String,
      default: join(import.meta.dirname, "..", "data", "candidates.json"),
      description: "Mined candidates to label",
    },
    labels: {
      type: String,
      default: join(import.meta.dirname, "..", "labels"),
      description: "Directory for saved labels",
    },
  },
});

const html = join(import.meta.dirname, "index.html");

async function readAllLabels(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let names: string[] = [];
  try {
    names = await readdir(argv.flags.labels);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      out[name.replace(/\.json$/, "")] = await Bun.file(join(argv.flags.labels, name)).json();
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

    if (url.pathname === "/api/candidates") {
      return new Response(Bun.file(argv.flags.data), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/labels" && req.method === "GET") {
      return Response.json(await readAllLabels());
    }

    if (url.pathname === "/api/label" && req.method === "POST") {
      const body = (await req.json()) as { id?: string; label?: string; note?: string };
      if (!body.id || !/^[\w-]+$/.test(body.id)) return new Response("bad id", { status: 400 });
      if (!body.label || !["good", "bad", "skip"].includes(body.label)) {
        return new Response("bad label", { status: 400 });
      }
      await mkdir(argv.flags.labels, { recursive: true });
      const record = { id: body.id, label: body.label, note: body.note ?? "" };
      await Bun.write(join(argv.flags.labels, `${body.id}.json`), JSON.stringify(record, null, 2));
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`Labeling UI: http://localhost:${server.port}`);
console.log(`Candidates:  ${argv.flags.data}`);
console.log(`Labels:      ${argv.flags.labels}/`);
