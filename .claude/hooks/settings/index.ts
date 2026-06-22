import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json";
const FETCH_TIMEOUT = 3000;

const SETTINGS_FILES = [".claude/settings.json", "user/settings.json"];

async function fetchSchema(): Promise<object | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch(SCHEMA_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return (await response.json()) as object;
  } catch {
    return null;
  }
}

async function readSettingsFile(path: string): Promise<object | null> {
  try {
    return await Bun.file(path).json();
  } catch {
    return null;
  }
}

interface SchemaObject {
  [key: string]: unknown;
  $defs?: Record<string, SchemaObject>;
  anyOf?: SchemaObject[];
  properties?: Record<string, SchemaObject>;
}

function patchSchema(schema: SchemaObject): void {
  patchHookIfField(schema);
  patchSandboxAppleEvents(schema);
}

function patchHookIfField(schema: SchemaObject): void {
  const hookCommand = schema.$defs?.hookCommand;
  if (!hookCommand?.anyOf) return;

  const ifProperty = {
    type: "string",
    description: "Permission rule pattern to filter when this hook fires (e.g. Bash(git *))",
  };

  for (const variant of hookCommand.anyOf) {
    if (variant.properties) {
      variant.properties.if = ifProperty;
    }
  }
}

function patchSandboxAppleEvents(schema: SchemaObject): void {
  const sandbox = schema.properties?.sandbox;
  if (!sandbox?.properties) return;

  sandbox.properties.allowAppleEvents = {
    type: "boolean",
    description: "Allow sandboxed processes to send Apple Events (macOS automation).",
  };
}

export async function validate(
  cwd: string,
  schema?: object | null,
): Promise<Map<string, string[]>> {
  const resolved = schema ?? (await fetchSchema());
  if (!resolved) return new Map();

  patchSchema(resolved as SchemaObject);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFn = ajv.compile(resolved);

  const errors = new Map<string, string[]>();

  for (const file of SETTINGS_FILES) {
    const fullPath = join(cwd, file);
    const settings = await readSettingsFile(fullPath);
    if (!settings) continue;

    if (!validateFn(settings) && validateFn.errors) {
      errors.set(
        file,
        validateFn.errors.map((e) => `${e.instancePath || "/"}: ${e.message}`),
      );
    }
  }

  return errors;
}
