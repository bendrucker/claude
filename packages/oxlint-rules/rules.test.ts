import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = join(import.meta.dirname, "index.ts");
const OXLINT = join(import.meta.dirname, "..", "..", "node_modules", ".bin", "oxlint");

/** Lints one snippet with a single local rule enabled, returning the rules that fired. */
async function lint(rule: string, code: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "oxlint-rules-"));
  try {
    const file = join(dir, "case.ts");
    await Bun.write(file, code);
    await Bun.write(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [{ name: "local", specifier: PLUGIN }],
        categories: {},
        rules: { [`local/${rule}`]: "error" },
      }),
    );
    const result = Bun.spawnSync([
      OXLINT,
      "-c",
      join(dir, ".oxlintrc.json"),
      "--format=json",
      file,
    ]);
    const parsed = JSON.parse(result.stdout.toString()) as {
      diagnostics: { code: string | null }[];
    };
    return parsed.diagnostics
      .map((d) => d.code)
      .filter((c): c is string => c !== null && c.startsWith("local("));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("no-chained-type-assertions", () => {
  const rule = "no-chained-type-assertions";

  test.each([
    ["single assertion", "declare const v: string; export const a = v as User;"],
    ["const assertion", "export const a = { retries: 3 } as const;"],
    ["assertion inside a call argument", "export const a = (lookup(v as Id)) as Entry;"],
    ["assertion inside an object literal", "export const a = ({ id: v as Id }) as Entry;"],
  ])("allows %s", async (_name, code) => {
    expect(await lint(rule, code)).toEqual([]);
  });

  test.each([
    ["through unknown", "export const a = v as unknown as User;"],
    ["through any", "export const a = v as any as User;"],
    ["through object", "export const a = v as object as User;"],
    ["through never", "export const a = v as never as User;"],
    ["parenthesized", "export const a = (v as unknown) as User;"],
    ["angle bracket", "export const a = <User><unknown>v;"],
  ])("rejects a chain %s", async (_name, code) => {
    expect(await lint(rule, code)).toEqual([`local(${rule})`]);
  });
});

describe("no-terminal-width", () => {
  const rule = "no-terminal-width";

  test.each([
    ["a fixed width", "export const width = 80;"],
    ["a flag override", "export const width = args.width ?? 80;"],
    ["writing to stdout", "process.stdout.write(line);"],
    ["columns on a local shadow", "function f(process: Fake) { return process.stdout.columns; }"],
  ])("allows %s", async (_name, code) => {
    expect(await lint(rule, code)).toEqual([]);
  });

  test.each([
    ["columns", "export const width = process.stdout.columns;"],
    ["columns with a fallback", "export const width = process.stdout.columns ?? 80;"],
    ["isTTY", "if (process.stdout.isTTY) render();"],
    ["computed access", 'export const width = process.stdout["columns"];'],
  ])("rejects %s", async (_name, code) => {
    expect(await lint(rule, code)).toEqual([`local(${rule})`]);
  });
});

describe("no-module-mocking", () => {
  const rule = "no-module-mocking";

  test.each([
    ["spying on an owned object", 'import { spyOn } from "bun:test"; spyOn(console, "log");'],
    ["a standalone mock function", 'import { mock } from "bun:test"; const fn = mock(() => 1);'],
    ["module on an unrelated local", "const mock = loader(); mock.module(name);"],
    ["module on an import from elsewhere", 'import { mock } from "./fake.ts"; mock.module(name);'],
  ])("allows %s", async (_name, code) => {
    expect(await lint(rule, code)).toEqual([]);
  });

  test.each([
    ["bun mock.module", 'import { mock } from "bun:test"; mock.module("./db.ts", () => ({}));'],
    ["bun mock.module as a global", 'mock.module("./db.ts", () => ({}));'],
    ["bun computed access", 'import { mock } from "bun:test"; mock["module"]("./db.ts", f);'],
    ["vitest vi.mock", 'import { vi } from "vitest"; vi.mock("./db.ts");'],
    ["vitest vi.doMock", 'import { vi } from "vitest"; vi.doMock("./db.ts");'],
    ["jest.mock", 'import { jest } from "@jest/globals"; jest.mock("./db.ts");'],
  ])("rejects %s", async (_name, code) => {
    expect(await lint(rule, code)).toEqual([`local(${rule})`]);
  });
});
