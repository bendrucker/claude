import { join } from "node:path";
import { z } from "zod";
import { corpusFiles, ROOT } from "./corpus";
import { type Hit, hitId, type Store, Verdict } from "./data";
import { sample } from "./sample";

const LabelInput = z.object({
  id: z.string(),
  verdict: Verdict,
  note: z.string(),
  pattern: z.string().optional(),
});

const FlagInput = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  span: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  note: z.string(),
  pattern: z.string().regex(/^[a-z0-9-]+$/),
});

export interface Context {
  before: string;
  pre: string;
  marked: string;
  post: string;
  after: string;
}

/** The hit's line split around its span, with the lines either side, as the label view shows it. */
export function context(hit: Pick<Hit, "line" | "span">, lines: readonly string[]): Context {
  const line = lines[hit.line - 1] ?? "";
  return {
    before: lines[hit.line - 2] ?? "",
    pre: line.slice(0, hit.span[0] - 1),
    marked: line.slice(hit.span[0] - 1, hit.span[1]),
    post: line.slice(hit.span[1]),
    after: lines[hit.line] ?? "",
  };
}

export interface ServeOptions {
  port: number;
  perCheck: number;
  root?: string;
}

export async function serve(
  data: Store,
  { port, perCheck, root = ROOT }: ServeOptions,
): Promise<Bun.Server<undefined>> {
  const swept = await data.sweep();
  if (swept === undefined) throw new Error("No sweep yet. Run `lab.ts sweep` first.");
  const corpus = new Set(await corpusFiles(swept.corpus, root));
  const files = new Map<string, string[]>();
  const linesOf = async (file: string): Promise<string[]> => {
    let lines = files.get(file);
    if (lines === undefined) {
      lines = (await Bun.file(join(root, file)).text()).split("\n");
      files.set(file, lines);
    }
    return lines;
  };
  const byId = new Map<string, Hit>([
    ...swept.hits.map((hit) => [hitId(hit), hit] as const),
    ...(await data.queue()).map((hit) => [hitId(hit), hit] as const),
  ]);
  const items = await Promise.all(
    sample(swept.hits, await data.labels(), await data.queue(), perCheck).map(async (item) =>
      Object.assign(item, context(item, await linesOf(item.file))),
    ),
  );
  const page = await Bun.file(join(import.meta.dirname, "index.html")).text();

  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const ts = new Date().toISOString();
      switch (url.pathname) {
        case "/api/items":
          return Response.json({ items, labels: await data.labels() });
        case "/api/patterns":
          return Response.json(await data.patterns());
        case "/api/files": {
          const counts = Map.groupBy(swept.hits, (hit) => hit.file);
          return Response.json(
            [...corpus].map((file) => ({ file, hits: counts.get(file)?.length ?? 0 })),
          );
        }
        case "/api/doc": {
          const file = url.searchParams.get("file") ?? "";
          if (!corpus.has(file)) return new Response("unknown file", { status: 404 });
          return Response.json({
            lines: await linesOf(file),
            hits: swept.hits.filter((hit) => hit.file === file),
            flags: (await data.flags()).filter((flag) => flag.file === file),
          });
        }
        case "/api/labels": {
          if (request.method !== "POST") break;
          const input = LabelInput.parse(await request.json());
          const hit = byId.get(input.id);
          if (hit === undefined) return new Response("unknown hit", { status: 404 });
          await data.addLabels([{ ...hit, ...input, by: "user", ts }]);
          return new Response("ok");
        }
        case "/api/flags": {
          if (request.method !== "POST") break;
          const input = FlagInput.parse(await request.json());
          if (!corpus.has(input.file)) return new Response("unknown file", { status: 404 });
          const match =
            (await linesOf(input.file))[input.line - 1]?.slice(input.span[0] - 1, input.span[1]) ??
            "";
          await data.addFlags([
            { ...input, id: `${input.file}|${input.line}|${input.span[0]}`, match, ts },
          ]);
          return new Response("ok");
        }
        case "/":
          return new Response(page, { headers: { "content-type": "text/html" } });
        default:
          break;
      }
      return new Response("not found", { status: 404 });
    },
  });
}
