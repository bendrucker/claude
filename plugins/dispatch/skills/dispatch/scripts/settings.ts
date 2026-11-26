import { z } from "zod";

const SettingsObject = z.record(z.string(), z.unknown());
export type Settings = z.infer<typeof SettingsObject>;

function isObject(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// Objects merge key by key, and arrays gain only the entries they lack.
export function mergeSettings(base: Settings, patch: Settings): Settings {
  const merged: Settings = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    if (isObject(existing) && isObject(value)) merged[key] = mergeSettings(existing, value);
    else if (isList(existing) && isList(value)) {
      const seen = new Set(existing.map((entry) => JSON.stringify(entry)));
      merged[key] = [
        ...existing,
        ...value.filter((entry) => {
          const encoded = JSON.stringify(entry);
          if (seen.has(encoded)) return false;
          seen.add(encoded);
          return true;
        }),
      ];
    } else merged[key] = value;
  }
  return merged;
}

export function settingsKeys(settings: Settings, prefix = ""): string[] {
  return Object.entries(settings)
    .flatMap(([key, value]) =>
      isObject(value) ? settingsKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .toSorted();
}

export function settingsPatch(allow: readonly string[], sandboxWrite: readonly string[]): Settings {
  const patch: Settings = {};
  if (allow.length > 0) patch.permissions = { allow: [...allow] };
  if (sandboxWrite.length > 0) patch.sandbox = { filesystem: { allowWrite: [...sandboxWrite] } };
  return patch;
}

export function parseSettings(text: string, label: string): Settings {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${label} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const parsed = SettingsObject.safeParse(json);
  if (!parsed.success) throw new Error(`${label} must hold a JSON object`);
  return parsed.data;
}
