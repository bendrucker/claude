import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { decodeJson } from "../decode/index";

const Report = z.looseObject({
  diagnostics: z.array(z.looseObject({ code: z.string().nullable(), filename: z.string() })),
});

const PLUGIN = join(import.meta.dirname, "index.ts");
const OXLINT = join(import.meta.dirname, "..", "..", "node_modules", ".bin", "oxlint");

type Case = [name: string, code: string];

const CASES: Record<string, { allows: Case[]; rejects: Case[] }> = {
  "no-chained-type-assertions": {
    allows: [
      ["single assertion", "declare const v: string; export const a = v as User;"],
      ["const assertion", "export const a = { retries: 3 } as const;"],
      ["assertion inside a call argument", "export const a = (lookup(v as Id)) as Entry;"],
      ["assertion inside an object literal", "export const a = ({ id: v as Id }) as Entry;"],
    ],
    rejects: [
      ["a chain through unknown", "export const a = v as unknown as User;"],
      ["a chain through any", "export const a = v as any as User;"],
      ["a chain through object", "export const a = v as object as User;"],
      ["a chain through never", "export const a = v as never as User;"],
      ["a chain parenthesized", "export const a = (v as unknown) as User;"],
      ["a chain angle bracket", "export const a = <User><unknown>v;"],
    ],
  },
  "no-unknown-returns": {
    allows: [
      ["a named return type", "export function f(): User { return u; }"],
      ["a generic defaulting to unknown", "export function f<T = unknown>(): T { return v as T; }"],
      ["an inferred return", "export function f() { return JSON.parse(s); }"],
      ["an unknown parameter", "export function f(v: unknown): string { return String(v); }"],
    ],
    rejects: [
      ["a bare unknown", "export function f(): unknown { return v; }"],
      ["a promised unknown", "export async function f(): Promise<unknown> { return v; }"],
      ["a union carrying unknown", "export function f(): string | unknown { return v; }"],
      ["an arrow", "export const f = (): unknown => v;"],
      ["a function-type parameter", "export function f(run: () => unknown): void {}"],
    ],
  },
  "no-terminal-width": {
    allows: [
      ["a fixed width", "export const width = 80;"],
      ["a flag override", "export const width = args.width ?? 80;"],
      ["writing to stdout", "process.stdout.write(line);"],
      ["columns on a local shadow", "function f(process: Fake) { return process.stdout.columns; }"],
    ],
    rejects: [
      ["columns", "export const width = process.stdout.columns;"],
      ["columns with a fallback", "export const width = process.stdout.columns ?? 80;"],
      ["isTTY", "if (process.stdout.isTTY) render();"],
      ["computed access", 'export const width = process.stdout["columns"];'],
    ],
  },
  "no-conditional-empty-object-spread": {
    allows: [
      ["a declared-then-assigned optional", "const o: T = { a }; if (b) o.b = b;"],
      ["a spread of a non-empty branch", "export const o = { ...(b ? { b } : { c }) };"],
      ["a conditional spread outside an object", "export const a = [...(b ? [] : [b])];"],
      ["a logical-and spread", "export const o = { ...(b && { b }) };"],
    ],
    rejects: [
      ["empty in the alternate", "export const o = { a, ...(b ? { b } : {}) };"],
      ["empty in the consequent", "export const o = { a, ...(b ? {} : { b }) };"],
      ["parenthesized", "export const o = { a, ...((b ? { b } : {})) };"],
      ["an undefined comparison", "export const o = { a, ...(b === undefined ? {} : { b }) };"],
    ],
  },
  "no-silent-catch": {
    allows: [
      [
        "a rethrow after a narrow",
        "export function f() { try { g(); } catch (error) { if (!(error instanceof RangeError)) throw error; return null; } }",
      ],
      [
        "a commented swallow",
        "export function f() { try { g(); } catch { /* an absent config file means defaults */ return null; } }",
      ],
      [
        "a return computed from the error",
        "export function f() { try { g(); } catch (error) { return error.message; } }",
      ],
      [
        "a catch with a non-return statement",
        "export function f() { try { g(); } catch { r(); } }",
      ],
    ],
    rejects: [
      ["a null default", "export function f() { try { g(); } catch (error) { return null; } }"],
      ["an undefined default", "export function f() { try { g(); } catch { return undefined; } }"],
      ["a false default", "export function f() { try { g(); } catch (error) { return false; } }"],
      ["an empty string default", 'export function f() { try { g(); } catch { return ""; } }'],
      ["an empty array default", "export function f() { try { g(); } catch { return []; } }"],
      ["an empty object default", "export function f() { try { g(); } catch { return {}; } }"],
      ["a bare return", "export function f() { try { g(); } catch (error) { return; } }"],
    ],
  },
  "no-module-mocking": {
    allows: [
      ["spying on an owned object", 'import { spyOn } from "bun:test"; spyOn(console, "log");'],
      ["a standalone mock function", 'import { mock } from "bun:test"; const fn = mock(() => 1);'],
      ["module on an unrelated local", "const mock = loader(); mock.module(name);"],
      [
        "module on an import from elsewhere",
        'import { mock } from "./fake.ts"; mock.module(name);',
      ],
    ],
    rejects: [
      ["bun mock.module", 'import { mock } from "bun:test"; mock.module("./db.ts", () => ({}));'],
      ["bun mock.module as a global", 'mock.module("./db.ts", () => ({}));'],
      ["bun computed access", 'import { mock } from "bun:test"; mock["module"]("./db.ts", f);'],
      ["vitest vi.mock", 'import { vi } from "vitest"; vi.mock("./db.ts");'],
      ["vitest vi.doMock", 'import { vi } from "vitest"; vi.doMock("./db.ts");'],
      ["jest.mock", 'import { jest } from "@jest/globals"; jest.mock("./db.ts");'],
    ],
  },
};

/** Backstop for a hung spawn, orders of magnitude above what a cold start costs. */
const TIMEOUT_MS = 120_000;

/** Runs oxlint, surfacing a spawn that died or crashed instead of parsing its empty output. */
function oxlint(args: string[]): string {
  const result = Bun.spawnSync([OXLINT, ...args], { timeout: TIMEOUT_MS });
  const stdout = result.stdout.toString();
  if (stdout.trim() !== "") return stdout;
  const stderr = result.stderr.toString().trim();
  throw new Error(
    `oxlint wrote no output within ${TIMEOUT_MS}ms (exit ${result.exitCode}, signal ${result.signalCode}): ${
      stderr === "" ? "(no stderr)" : stderr
    }`,
  );
}

/**
 * Lints every case in one oxlint run and returns the rules each fired.
 *
 * Batching keeps process startup out of the tests. An oxlint spawn costs seconds on a cold
 * runner and milliseconds once warm, so charging the first one to a test makes that test's
 * timeout a coin flip.
 */
async function lintAll(): Promise<(rule: string, name: string) => string[]> {
  const dir = await mkdtemp(join(tmpdir(), "oxlint-rules-"));
  try {
    const cases = Object.entries(CASES).flatMap(([rule, { allows, rejects }]) =>
      [...allows, ...rejects].map(([name, code]) => ({ key: `${rule} ${name}`, code })),
    );
    const collision = cases.find(({ key }, index) => cases.findIndex((c) => c.key === key) < index);
    if (collision !== undefined) throw new Error(`two cases share a name: ${collision.key}`);

    const keys = new Map(cases.map(({ key }, index) => [`case-${index}.ts`, key]));
    await Promise.all(
      cases.map(({ code }, index) => Bun.write(join(dir, `case-${index}.ts`), code)),
    );

    const config = join(dir, ".oxlintrc.json");
    await Bun.write(
      config,
      JSON.stringify({
        jsPlugins: [{ name: "local", specifier: PLUGIN }],
        categories: {},
        rules: Object.fromEntries(Object.keys(CASES).map((rule) => [`local/${rule}`, "error"])),
      }),
    );

    const files = [...keys.keys()].map((file) => join(dir, file));
    const report = decodeJson(
      Report,
      oxlint(["-c", config, "--format=json", ...files]),
      "oxlint --format=json",
    );

    const fired = new Map([...keys.values()].map((key) => [key, [] as string[]]));
    for (const { code, filename } of report.diagnostics) {
      const key = keys.get(basename(filename));
      if (code !== null && key !== undefined) fired.get(key)?.push(code);
    }

    return (rule, name) => {
      const codes = fired.get(`${rule} ${name}`);
      if (codes === undefined) throw new Error(`case was never linted: ${rule} ${name}`);
      return codes.filter((code) => code === `local(${rule})`);
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const fired = await lintAll();

describe.each(Object.entries(CASES))("%s", (rule, { allows, rejects }) => {
  test.each(allows)("allows %s", (name) => {
    expect(fired(rule, name)).toEqual([]);
  });

  test.each(rejects)("rejects %s", (name) => {
    expect(fired(rule, name)).toEqual([`local(${rule})`]);
  });
});
