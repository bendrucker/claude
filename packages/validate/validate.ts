import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type { ErrorObject } from "ajv";

import addFormats from "ajv-formats";

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
  let schema: Record<string, unknown>;
  if (schemaPath.startsWith("http")) {
    const response = await fetch(schemaPath);
    schema = await response.json();
  } else {
    schema = await Bun.file(schemaPath).json();
  }
  patchHookSchema(schema);
  patchSandboxSchema(schema);
  return schema;
}

function patchHookSchema(schema: Record<string, unknown>): void {
  const defs = schema.$defs as Record<string, Record<string, unknown>> | undefined;
  const hookCommand = defs?.hookCommand as { anyOf?: Array<Record<string, unknown>> } | undefined;
  if (!hookCommand?.anyOf) return;

  for (const variant of hookCommand.anyOf) {
    const props = variant.properties as Record<string, unknown> | undefined;
    if (props) {
      props.if = {
        type: "string",
        description: "Permission rule pattern to filter when this hook fires",
      };
    }
  }
}

function patchSandboxSchema(schema: Record<string, unknown>): void {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const sandbox = props?.sandbox;
  const sandboxProps = sandbox?.properties as Record<string, unknown> | undefined;
  if (!sandboxProps) return;

  sandboxProps.allowAppleEvents = {
    type: "boolean",
    description: "Allow sandboxed commands to send macOS Apple Events (osascript, open)",
  };
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
