#!/usr/bin/env bun

import { join } from "node:path";
import { z } from "zod";
import { anglesSchema } from "./angles";
import { effortsSchema } from "./efforts";

export const documentNames = ["efforts", "angles"] as const;

export type Document = (typeof documentNames)[number];

// The YAML files carry a `yaml-language-server` directive pointing at these,
// so the editor validates against the same shapes the CLI parses with.
const documents: Record<Document, z.ZodType> = { efforts: effortsSchema, angles: anglesSchema };

export function schemaPath(dir: string, name: Document): string {
  return join(dir, `${name}.schema.json`);
}

// oxfmt owns the formatting of the committed files, so comparisons go through
// the parsed object rather than the serialized text.
export function schemaObject(text: string): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(text));
}

export function serialize(name: Document): string {
  const schema = z.toJSONSchema(documents[name], { target: "draft-2020-12" });
  return `${JSON.stringify(schema, null, 2)}\n`;
}

if (import.meta.main) {
  const dir = join(import.meta.dirname, "..");
  await Promise.all(documentNames.map((name) => Bun.write(schemaPath(dir, name), serialize(name))));
}
