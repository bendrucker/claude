#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";

// Serves blinded body pairs from scripts/ab-pairs.ts to a phone and saves each label unblinded
// to feedback/ab/<id>.json. The browser never sees which arm sits on which side.

const program = new Command()
  .name("ab-server")
  .option("--port <n>", "port to listen on", "4321")
  .option("--pairs <file>", "pairs file", join(import.meta.dirname, "..", "data", "ab-pairs.json"))
  .option(
    "--labels <dir>",
    "label output directory",
    join(import.meta.dirname, "..", "feedback", "ab"),
  )
  .parse();

const opts = program.opts();

const Side = z.object({ arm: z.string(), body: z.string() });
const Pair = z.object({
  id: z.string(),
  group: z.string(),
  case: z.string(),
  left: Side,
  right: Side,
});
const Label = z.object({
  choice: z.enum(["left", "right", "tie"]),
  reasons: z.array(z.string()),
  note: z.string(),
  edited: z.string().optional(),
});
const Saved = Label.extend({ id: z.string() });

const pairs = z.array(Pair).parse(await Bun.file(opts.pairs).json());
const byId = new Map(pairs.map((p) => [p.id, p]));
await mkdir(opts.labels, { recursive: true });

async function savedLabels(): Promise<Record<string, z.infer<typeof Saved>>> {
  const names = (await readdir(opts.labels)).filter((name) => name.endsWith(".json"));
  const saved = await Promise.all(
    names.map(async (name) => Saved.safeParse(await Bun.file(join(opts.labels, name)).json())),
  );
  return Object.fromEntries(saved.flatMap((s) => (s.success ? [[s.data.id, s.data]] : [])));
}

const server = Bun.serve({
  port: Number(opts.port),
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(Bun.file(join(import.meta.dirname, "ab.html")), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/api/pairs") {
      const labels = await savedLabels();
      return Response.json(
        pairs.map((p) => ({
          id: p.id,
          group: p.group,
          case: p.case,
          left: p.left.body,
          right: p.right.body,
          label: labels[p.id] ?? null,
        })),
      );
    }
    const match = /^\/api\/label\/([\w-]+)$/.exec(url.pathname);
    if (match !== null && req.method === "POST") {
      const pair = byId.get(match[1]);
      if (pair === undefined) return new Response("unknown pair", { status: 404 });
      const label = Label.parse(await req.json());
      const winner = label.choice === "tie" ? "tie" : pair[label.choice].arm;
      const record = {
        id: pair.id,
        group: pair.group,
        case: pair.case,
        ...label,
        winner,
        left: pair.left.arm,
        right: pair.right.arm,
        at: new Date().toISOString(),
      };
      await Bun.write(join(opts.labels, `${pair.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`A/B labeler on port ${server.port}: ${pairs.length} pairs`);
