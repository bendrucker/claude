import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const Id = z.string().regex(/^[\w-]+$/);

/** A draft-review POST body: the sample id and whatever the UI recorded for it. */
export const Feedback = z.looseObject({ id: Id, feedback: z.looseObject({}) });

/** Every `*.json` in `dir`, keyed by file stem. A missing directory or an unparseable file reads as absent. */
export async function readJsonDir(dir: string): Promise<Record<string, unknown>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
  const read = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          const value: unknown = await Bun.file(join(dir, name)).json();
          return [[name.slice(0, -".json".length), value] as const];
        } catch (error) {
          // A half-written file from a crashed save should not hide the rest.
          if (error instanceof SyntaxError) return [];
          throw error;
        }
      }),
  );
  return Object.fromEntries(read.flat());
}

export async function writeJson(dir: string, id: string, value: unknown): Promise<void> {
  await Bun.write(join(dir, `${Id.parse(id)}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

export interface FeedbackEndpoint {
  get(): Promise<Response>;
  post(req: Request): Promise<Response>;
}

/** GET returns every saved record in `dir`. POST validates the body and saves `toFile(body)` as `<id>.json`. */
export function feedbackEndpoint<T extends { id: string }>(
  dir: string,
  schema: z.ZodType<T>,
  toFile: (body: T) => object = (body) => body,
): FeedbackEndpoint {
  return {
    async get(): Promise<Response> {
      return Response.json(await readJsonDir(dir));
    },
    async post(req: Request): Promise<Response> {
      const body = schema.safeParse(await req.json());
      if (!body.success) return new Response(z.prettifyError(body.error), { status: 400 });
      await writeJson(dir, body.data.id, toFile(body.data));
      return Response.json({ ok: true });
    },
  };
}

export function fileResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), { headers: { "content-type": contentType } });
}
