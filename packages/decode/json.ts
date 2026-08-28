import type { z } from "zod";
import { DecodeError } from "./error";

/** Validate an already-parsed value. `source` labels the seam in any failure. */
export function decode<S extends z.ZodType>(
  schema: S,
  value: unknown,
  source: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw DecodeError.invalid(source, result.error);
  return result.data;
}

/** Parse JSON text and validate it. `source` labels the seam in any failure. */
export function decodeJson<S extends z.ZodType>(
  schema: S,
  text: string,
  source: string,
): z.output<S> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw DecodeError.syntax(source, text, error);
  }
  return decode(schema, value, source);
}

/** Validate every record of newline-delimited JSON. Blank lines are skipped. */
export function decodeJsonLines<S extends z.ZodType>(
  schema: S,
  text: string,
  source: string,
): z.output<S>[] {
  const records: z.output<S>[] = [];

  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    records.push(decodeJson(schema, line, `${source} line ${index + 1}`));
  }

  return records;
}
