import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type { ErrorObject } from "ajv";

import addFormats from "ajv-formats";
import { z } from "zod";
import { decode, decodeFile } from "../decode/index";
import { loadOverlaySchema, Schema } from "./overlay";

/** A schema to validate against: a file path, an http(s) URL, or an in-memory overlay merge. */
export type SchemaRef = string | { overlay: string };

const SCHEMAS_DIR = "schemas";

function cacheKey(ref: SchemaRef): string {
  return typeof ref === "string" ? ref : `overlay:${ref.overlay}`;
}

function isCI(): boolean {
  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

interface CacheEntry {
  validate: ValidateFunction;
  schema: Record<string, unknown>;
}

const validatorCache = new Map<string, CacheEntry>();

const Properties = z.record(z.string(), z.unknown()).catch({});

export function createValidator(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

export function formatError(
  file: string,
  error: Pick<ErrorObject, "instancePath" | "message">,
): string {
  const path = error.instancePath || "/";
  const message = `${path}: ${error.message}`;

  if (isCI()) {
    return `::error file=${file}::${message}`;
  }
  return `  ${file}: ${message}`;
}

function formatWarning(file: string, key: string): string {
  const message = `unknown property "${key}"`;

  if (isCI()) {
    return `::warning file=${file}::${message}`;
  }
  return `  ⚠ ${file}: ${message}`;
}

export async function loadSchema(ref: SchemaRef): Promise<Schema> {
  if (typeof ref !== "string") {
    return loadOverlaySchema(SCHEMAS_DIR, ref.overlay);
  }
  if (ref.startsWith("http")) {
    const response = await fetch(ref);
    return decode(Schema, await response.json(), ref);
  }
  return decodeFile(Schema, ref);
}

export async function validateFile(
  file: string,
  schema: SchemaRef,
  options?: { ajv?: Ajv; warnAdditional?: boolean },
): Promise<ValidationResult> {
  const instance = options?.ajv ?? createValidator();

  const key = cacheKey(schema);
  let entry = validatorCache.get(key);
  if (!entry) {
    const loaded = await loadSchema(schema);
    const validate = instance.compile(loaded);
    entry = { validate, schema: loaded };
    validatorCache.set(key, entry);
  }

  const data = await decodeFile(Schema, file);
  const valid = entry.validate(data);

  const errors = valid
    ? []
    : (entry.validate.errors?.map((err: ErrorObject) => formatError(file, err)) ?? []);

  const warnings: string[] = [];
  if (options?.warnAdditional && entry.schema.properties) {
    const known = new Set(Object.keys(Properties.parse(entry.schema.properties)));
    for (const property of Object.keys(data)) {
      if (property !== "$schema" && !known.has(property)) {
        warnings.push(formatWarning(file, property));
      }
    }
  }

  return { errors, warnings };
}

export function reportAndExit({ errors, warnings }: ValidationResult): void {
  for (const w of warnings) console.log(w);

  if (errors.length > 0) {
    console.log("Validation errors:\n");
    for (const e of errors) console.log(e);
    process.exit(1);
  }
}
