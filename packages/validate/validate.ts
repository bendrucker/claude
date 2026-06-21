import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type { ErrorObject } from "ajv";

import addFormats from "ajv-formats";
import { loadOverlaySchema, type Schema } from "./overlay";

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

export function createValidator(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

export function formatError(file: string, error: ErrorObject): string {
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
    return response.json();
  }
  return Bun.file(ref).json();
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

  const data = await Bun.file(file).json();
  const valid = entry.validate(data);

  const errors = valid
    ? []
    : (entry.validate.errors?.map((err: ErrorObject) => formatError(file, err)) ?? []);

  const warnings: string[] = [];
  if (options?.warnAdditional && entry.schema.properties) {
    const known = new Set(Object.keys(entry.schema.properties as Record<string, unknown>));
    for (const key of Object.keys(data as Record<string, unknown>)) {
      if (key !== "$schema" && !known.has(key)) {
        warnings.push(formatWarning(file, key));
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
