#!/usr/bin/env bun

import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { z } from "zod";
import { fileResponse, readJsonDir, writeJson } from "../../../../../packages/eval-corpus/label";

// Serves blinded body pairs from scripts/ab-pairs.ts to a phone and saves each label unblinded
// to feedback/ab/<id>.json. The browser never sees which arm sits on which side.

const Side = z.object({ arm: z.string(), body: z.string() });
export const Pair = z.object({
  id: z.string(),
  group: z.string(),
  case: z.string(),
  left: Side,
  right: Side,
});
export type Pair = z.infer<typeof Pair>;
const Label = z.object({
  choice: z.enum(["left", "right", "tie"]),
  reasons: z.array(z.string()),
  note: z.string(),
  edited: z.string().optional(),
});
const Saved = Label.extend({ id: z.string() });

export interface AbOptions {
  pairs: Pair[];
  labelsDir: string;
  now?: () => Date;
}

async function savedLabels(dir: string): Promise<Map<string, z.infer<typeof Saved>>> {
  const saved = Object.values(await readJsonDir(dir)).map((value) => Saved.safeParse(value));
  return new Map(saved.flatMap((s) => (s.success ? [[s.data.id, s.data]] : [])));
}

export function createHandler({
  pairs,
  labelsDir,
  now = () => new Date(),
}: AbOptions): (req: Request) => Promise<Response> {
  const byId = new Map(pairs.map((p) => [p.id, p]));
  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/")
      return fileResponse(join(import.meta.dirname, "ab.html"), "text/html; charset=utf-8");
    if (url.pathname === "/api/pairs") {
      const labels = await savedLabels(labelsDir);
      return Response.json(
        pairs.map((p) => ({
          id: p.id,
          group: p.group,
          case: p.case,
          left: p.left.body,
          right: p.right.body,
          label: labels.get(p.id) ?? null,
        })),
      );
    }
    const labelId = /^\/api\/label\/([\w-]+)$/.exec(url.pathname)?.[1];
    if (labelId !== undefined && req.method === "POST") {
      const pair = byId.get(labelId);
      if (pair === undefined) return new Response("unknown pair", { status: 404 });
      const label = Label.safeParse(await req.json());
      if (!label.success) return new Response(z.prettifyError(label.error), { status: 400 });
      await writeJson(labelsDir, pair.id, {
        id: pair.id,
        group: pair.group,
        case: pair.case,
        ...label.data,
        winner: label.data.choice === "tie" ? "tie" : pair[label.data.choice].arm,
        left: pair.left.arm,
        right: pair.right.arm,
        at: now().toISOString(),
      });
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  };
}

function port(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

export const program = new Command("ab-server")
  .description("Label blinded pr-body A/B pairs from a phone.")
  .option("--port <n>", "port to listen on", port, 4321)
  .option("--pairs <file>", "pairs file", join(import.meta.dirname, "..", "data", "ab-pairs.json"))
  .option(
    "--labels <dir>",
    "label output directory",
    join(import.meta.dirname, "..", "feedback", "ab"),
  )
  .action(async (options) => {
    const pairs = z.array(Pair).parse(await Bun.file(options.pairs).json());
    const server = Bun.serve({
      port: options.port,
      hostname: "0.0.0.0",
      fetch: createHandler({ pairs, labelsDir: options.labels }),
    });
    console.log(`A/B labeler on port ${server.port}: ${pairs.length} pairs`);
  });

if (import.meta.main) {
  await program.parseAsync();
}
