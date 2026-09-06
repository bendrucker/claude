import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

export const QUERIES_DIR = join(import.meta.dirname, "..", "resources", "queries");

// A `-- ---` fence in line comments: DuckDB sees comments, the parser sees YAML, and the
// file stays uniformly `--` commented so the free prose below reads as one block with it.
const FENCE = /^--\s*---\s*$/;

export const QueryParam = z.strictObject({
  name: z.string().min(1),
  default: z.union([z.string(), z.number()]).optional(),
  required: z.boolean().optional(),
  meaning: z.string().optional(),
});
export type QueryParam = z.infer<typeof QueryParam>;

// A bare string is the common case: a param the query passes straight to a filter macro.
const QueryParamEntry = z.union([
  z
    .string()
    .min(1)
    .transform((name): QueryParam => ({ name })),
  QueryParam,
]);

export const QueryHeader = z.strictObject({
  name: z.string().min(1),
  tier: z.union([z.literal(1), z.literal(2)]),
  summary: z.string().min(1),
  description: z.string().optional(),
  // A literal YAML block (`|-`), so the SQL keeps its own line breaks and indentation.
  example: z.string().optional(),
  params: z.array(QueryParamEntry).default([]),
  dimensions: z.array(z.string()).default([]),
  reads: z.enum(["index", "disk"]).default("index"),
  extensions: z.array(z.enum(["markdown", "yaml"])).default([]),
});
export type QueryHeader = z.infer<typeof QueryHeader>;

export function parseQueryHeader(sql: string): QueryHeader {
  const lines = sql.split("\n");
  if (lines[0] === undefined || !FENCE.test(lines[0])) {
    throw new Error("no `-- ---` header fence on line 1");
  }
  const close = lines.findIndex((line, index) => index > 0 && FENCE.test(line));
  if (close === -1) throw new Error("unterminated `-- ---` header fence");

  const yaml = lines.slice(1, close).map((line) => {
    if (!line.startsWith("--")) throw new Error(`header line is not a comment: ${line}`);
    // One space, so nested YAML indentation survives.
    return line.slice(2).replace(/^ /, "");
  });
  return QueryHeader.parse(Bun.YAML.parse(yaml.join("\n")));
}

export async function loadQueryHeaders(dir: string = QUERIES_DIR): Promise<QueryHeader[]> {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .toSorted();
  return Promise.all(
    files.map(async (file) => {
      const name = basename(file, ".sql");
      try {
        const header = parseQueryHeader(await Bun.file(join(dir, file)).text());
        if (header.name !== name) throw new Error(`header names "${header.name}"`);
        return header;
      } catch (error) {
        throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }),
  );
}
