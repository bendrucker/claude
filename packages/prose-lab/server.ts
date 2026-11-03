import { join } from "node:path";
import { z } from "zod";
import { corpusFiles, filePath, ROOT } from "./corpus";
import {
  type Corpus,
  DOCS,
  type Flag,
  type Hit,
  hitId,
  type Label,
  type Store,
  Verdict,
} from "./data";
import { next, rate } from "./deck";
import { sample } from "./sample";
import { overlaps } from "./score";
import { board, type CheckRow, checkRows } from "./status";

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

export interface Reveal {
  check: string;
  message: string;
  shipped: boolean;
  /** Other checks with a hit on the voted span. */
  others: string[];
  /** The voted check's rating and each other check's, after the vote. */
  ratings: CheckRow[];
}

/** What a vote on `hit` showed once the card is turned over. */
export function reveal(
  hit: Hit,
  hits: readonly Hit[],
  byCheck: ReadonlyMap<string, readonly Hit[]>,
  labels: readonly Label[],
  flags: readonly Flag[],
): Reveal {
  const others = [
    ...new Set(
      hits.filter((other) => other.check !== hit.check && overlaps(other, hit)).map((h) => h.check),
    ),
  ];
  return {
    check: hit.check,
    message: hit.message,
    shipped: hit.shipped !== false,
    others,
    ratings: [hit.check, ...others].map((check) => {
      const { unlabeled: _, ...row } = rate(check, byCheck.get(check) ?? [], labels, flags);
      return row;
    }),
  };
}

export interface ServeOptions {
  port: number;
  perCheck: number;
  root?: string;
  docs?: string;
  /** Limits the deck, sample, and documents to this corpus's files. */
  corpus?: Corpus | undefined;
}

export async function serve(
  data: Store,
  { port, perCheck, root = ROOT, docs = DOCS, corpus: only }: ServeOptions,
): Promise<{ server: Bun.Server<undefined>; sampled: number }> {
  const swept = await data.sweep();
  if (swept === undefined) throw new Error("No sweep yet. Run `lab.ts sweep` first.");
  const { repos } = swept;
  const corpus = new Set(await corpusFiles(only ?? swept.corpus, { root, docs, repos }));
  const within = <T extends Hit>(hits: readonly T[]): T[] =>
    only === undefined ? [...hits] : hits.filter((hit) => corpus.has(hit.file));
  const sweptHits = within(swept.hits);
  const files = new Map<string, string[]>();
  const linesOf = async (file: string): Promise<string[]> => {
    let lines = files.get(file);
    if (lines === undefined) {
      lines = (await Bun.file(filePath(file, repos, root)).text()).split("\n");
      files.set(file, lines);
    }
    return lines;
  };
  const byId = new Map<string, Hit>([
    ...sweptHits.map((hit) => [hitId(hit), hit] as const),
    ...(await data.queue()).map((hit) => [hitId(hit), hit] as const),
  ]);
  const items = await Promise.all(
    sample(sweptHits, await data.labels(), within(await data.queue()), perCheck).map(async (item) =>
      Object.assign(item, context(item, await linesOf(item.file))),
    ),
  );
  const page = await Bun.file(join(import.meta.dirname, "index.html")).text();
  const seen = new Set<string>();
  // Re-read on each card, since a background `propose` run appends to the deck.
  const deck = async () => {
    const [hits, labels, flags] = await Promise.all([data.hits(), data.labels(), data.flags()]);
    return { hits: within(hits), labels, flags };
  };
  const currentBoard = async () => {
    const { hits, labels, flags } = await deck();
    return board(checkRows(hits, labels, flags));
  };

  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const ts = new Date().toISOString();
      switch (url.pathname) {
        case "/api/items":
          return Response.json({ items, labels: await data.labels() });
        case "/api/next": {
          const { hits, labels, flags } = await deck();
          const hit = next(hits, labels, flags, seen);
          const shown = board(checkRows(hits, labels, flags));
          if (hit === undefined) return Response.json({ card: null, board: shown });
          const id = hitId(hit);
          seen.add(id);
          const card = {
            id,
            file: hit.file,
            line: hit.line,
            ...context(hit, await linesOf(hit.file)),
          };
          return Response.json({ card, board: shown });
        }
        case "/api/board":
          return Response.json(await currentBoard());
        case "/api/vote": {
          if (request.method !== "POST") break;
          const input = LabelInput.parse(await request.json());
          const hit = (await deck()).hits.find((entry) => hitId(entry) === input.id);
          if (hit === undefined) return new Response("unknown hit", { status: 404 });
          await data.addLabels([{ ...hit, ...input, by: "user", ts }]);
          const { hits, labels, flags } = await deck();
          const byCheck = Map.groupBy(hits, (entry) => entry.check);
          return Response.json({
            reveal: reveal(hit, hits, byCheck, labels, flags),
            board: board(checkRows(hits, labels, flags)),
          });
        }
        case "/api/patterns":
          return Response.json(await data.patterns());
        case "/api/files": {
          const counts = Map.groupBy(sweptHits, (hit) => hit.file);
          return Response.json(
            [...corpus].map((file) => ({ file, hits: counts.get(file)?.length ?? 0 })),
          );
        }
        case "/api/doc": {
          const file = url.searchParams.get("file") ?? "";
          if (!corpus.has(file)) return new Response("unknown file", { status: 404 });
          return Response.json({
            lines: await linesOf(file),
            hits: sweptHits.filter((hit) => hit.file === file),
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
  return { server, sampled: items.length };
}
