import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
export type { ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "fs/promises";

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

export async function loadSchema(schemaPath: string): Promise<Record<string, unknown>> {
  if (schemaPath.startsWith("http")) {
    const response = await fetch(schemaPath);
    return response.json();
  }
  const content = await readFile(schemaPath, "utf8");
  return JSON.parse(content);
}

export async function validateFile(
  file: string,
  schemaPath: string,
  options?: { ajv?: Ajv; warnAdditional?: boolean },
): Promise<ValidationResult> {
  const instance = options?.ajv ?? createValidator();

  let entry = validatorCache.get(schemaPath);
  if (!entry) {
    const schema = await loadSchema(schemaPath);
    const validate = instance.compile(schema);
    entry = { validate, schema };
    validatorCache.set(schemaPath, entry);
  }

  const content = await readFile(file, "utf8");
  const data = JSON.parse(content);
  const valid = entry.validate(data);

  const errors = valid
    ? []
    : entry.validate.errors!.map((err: ErrorObject) => formatError(file, err));

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
