import type { z } from "zod";
import { decodeJson, decodeJsonLines } from "./json";

/** Read and validate a JSON file. Failures name the path. */
export async function decodeFile<S extends z.ZodType>(
  schema: S,
  path: string,
): Promise<z.output<S>> {
  return decodeJson(schema, await Bun.file(path).text(), path);
}

/** Read and validate a newline-delimited JSON file. Failures name the path. */
export async function decodeFileLines<S extends z.ZodType>(
  schema: S,
  path: string,
): Promise<z.output<S>[]> {
  return decodeJsonLines(schema, await Bun.file(path).text(), path);
}

/** Read and validate stdin, the input seam for hook scripts. */
export async function decodeStdin<S extends z.ZodType>(
  schema: S,
  source = "stdin",
): Promise<z.output<S>> {
  return decodeJson(schema, await Bun.stdin.text(), source);
}
