import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ErrorObject, formatError, validateFile } from "./validate";

let tempDir: string;
let schemaPath: string;

const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    count: { type: "number" },
  },
  required: ["name"],
};

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "validate-test-"));
  await mkdir(join(tempDir, "schemas"), { recursive: true });
  schemaPath = join(tempDir, "schemas/test.json");
  await Bun.write(schemaPath, JSON.stringify(schema));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("validateFile", () => {
  const fixtures: {
    name: string;
    data: unknown;
    warnAdditional?: boolean;
    errors: string[];
    warnings: string[];
  }[] = [
    {
      name: "valid data",
      data: { name: "test" },
      errors: [],
      warnings: [],
    },
    {
      name: "missing required property",
      data: { count: 5 },
      errors: ["must have required property 'name'"],
      warnings: [],
    },
    {
      name: "wrong types",
      data: { name: 123, count: "not a number" },
      errors: ["must be string", "must be number"],
      warnings: [],
    },
    {
      name: "unknown properties without warnAdditional",
      data: { name: "test", unknown: true },
      errors: [],
      warnings: [],
    },
    {
      name: "unknown properties with warnAdditional",
      data: { name: "test", unknown: true, alsoUnknown: "yes" },
      warnAdditional: true,
      errors: [],
      warnings: ['unknown property "unknown"', 'unknown property "alsoUnknown"'],
    },
    {
      name: "$schema excluded from warnings",
      data: { $schema: "https://example.com/schema.json", name: "test" },
      warnAdditional: true,
      errors: [],
      warnings: [],
    },
    {
      name: "errors and warnings together",
      data: { name: 123, extra: true },
      warnAdditional: true,
      errors: ["must be string"],
      warnings: ['unknown property "extra"'],
    },
  ];

  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const file = join(tempDir, `${fixture.name.replaceAll(/\s+/g, "-")}.json`);
      await Bun.write(file, JSON.stringify(fixture.data));

      const result = await validateFile(
        file,
        schemaPath,
        fixture.warnAdditional ? { warnAdditional: true } : undefined,
      );

      expect(result.errors).toHaveLength(fixture.errors.length);
      for (const [i, pattern] of fixture.errors.entries()) {
        expect(result.errors[i]).toContain(pattern);
      }

      expect(result.warnings).toHaveLength(fixture.warnings.length);
      for (const [i, pattern] of fixture.warnings.entries()) {
        expect(result.warnings[i]).toContain(pattern);
      }
    });
  }
});

describe("formatError", () => {
  const fixtures: {
    name: string;
    file: string;
    error: Pick<ErrorObject, "instancePath" | "message">;
    ci: boolean;
    expected: string;
  }[] = [
    {
      name: "local with instancePath",
      file: "settings.json",
      error: { instancePath: "/name", message: "must be string" },
      ci: false,
      expected: "  settings.json: /name: must be string",
    },
    {
      name: "local with empty instancePath",
      file: "settings.json",
      error: { instancePath: "", message: "must have required property 'name'" },
      ci: false,
      expected: "  settings.json: /: must have required property 'name'",
    },
    {
      name: "CI annotation",
      file: "settings.json",
      error: { instancePath: "/name", message: "must be string" },
      ci: true,
      expected: "::error file=settings.json::/name: must be string",
    },
  ];

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      // isCI() reads both CI and GITHUB_ACTIONS; control both so the ambient
      // CI environment (GITHUB_ACTIONS=true on Actions) cannot leak in.
      const original = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
      process.env.CI = fixture.ci ? "true" : "";
      process.env.GITHUB_ACTIONS = fixture.ci ? "true" : "";

      try {
        const result = formatError(fixture.file, fixture.error);
        expect(result).toBe(fixture.expected);
      } finally {
        for (const key of ["CI", "GITHUB_ACTIONS"] as const) {
          const value = original[key];
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  }
});
