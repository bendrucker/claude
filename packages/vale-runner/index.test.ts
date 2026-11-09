import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  Alert as PromptingAlert,
  lint as promptingLint,
} from "../../plugins/prompting/skills/scan/scripts/vale";
import { Alert as FixAlert, lint as fixLint } from "../../plugins/vale/skills/fix/scripts/job";
import { Alert as WritingAlert, lintFile } from "../../plugins/writing/detection/vale";
import { Alert, lint, ValeError } from "./index";

const FILES = {
  "clean.md": "Clean.\n",
  "foo.md": "Say foo.\n",
  "bad.md": "---\n: [unclosed\n---\n\nSay foo.\n",
};
type File = keyof typeof FILES;

let root = "";
const good = (): string => join(root, "good");
const broken = (): string => join(root, "broken");
const at = (dir: string, file: File): string => join(dir, file);

async function project(dir: string, style: string): Promise<void> {
  await mkdir(join(dir, "styles", "Test"), { recursive: true });
  await Bun.write(
    join(dir, "styles", "Test", "Foo.yml"),
    'extends: existence\nmessage: "%s"\nlevel: error\ntokens:\n  - foo\n',
  );
  await Bun.write(
    join(dir, ".vale.ini"),
    `StylesPath = styles\nMinAlertLevel = suggestion\n\n[*.md]\nBasedOnStyles = ${style}\n`,
  );
  await Promise.all(Object.entries(FILES).map(([name, text]) => Bun.write(join(dir, name), text)));
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vale-runner-"));
  await Promise.all([project(good(), "Test"), project(broken(), "Missing")]);
});

afterAll(() => rm(root, { recursive: true, force: true }));

const config = (dir: string): string => join(dir, ".vale.ini");

describe("lint", () => {
  test.each<{ name: string; file: File; checks: string[] }>([
    { name: "exit 0 returns no alerts", file: "clean.md", checks: [] },
    { name: "exit 1 returns the error-level alert", file: "foo.md", checks: ["Test.Foo"] },
  ])("$name", async ({ file, checks }) => {
    const alerts = await lint([at(good(), file)], { config: config(good()) });
    expect([...alerts.values()].flat().map((alert) => alert.Check)).toEqual(checks);
  });

  test("exit 2 throws a ValeError", async () => {
    const thrown = await lint([at(good(), "clean.md")], { config: config(broken()) }).catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(ValeError);
    expect(thrown).toMatchObject({ exitCode: 2 });
  });

  test("merges alerts across batches", async () => {
    const files: File[] = ["foo.md", "clean.md", "foo.md", "clean.md", "foo.md"];
    const paths = files.map((file, index) => join(good(), `${index}-${file}`));
    await Promise.all(
      paths.map((path, index) => Bun.write(path, FILES[files[index] ?? "clean.md"])),
    );
    const alerts = await lint(paths, { config: config(good()), batch: 2 });
    expect([...alerts.keys()].toSorted()).toEqual(
      paths.filter((_, index) => files[index] === "foo.md"),
    );
  });

  test("bisects a failing batch down to the file vale cannot read", async () => {
    const skipped: string[] = [];
    const alerts = await lint(
      (["clean.md", "bad.md", "foo.md"] as const).map((file) => at(good(), file)),
      { config: config(good()), onSkip: (path) => void skipped.push(path) },
    );
    expect({ alerts: [...alerts.keys()], skipped }).toEqual({
      alerts: [at(good(), "foo.md")],
      skipped: [at(good(), "bad.md")],
    });
  });

  test("throws for an unreadable file without onSkip", async () => {
    expect(
      await lint([at(good(), "bad.md")], { config: config(good()) }).catch(() => "threw"),
    ).toBe("threw");
  });

  test("throws for a broken config instead of skipping every file", async () => {
    const skipped: string[] = [];
    const outcome = await lint([at(broken(), "clean.md"), at(broken(), "foo.md")], {
      config: config(broken()),
      onSkip: (path) => void skipped.push(path),
    }).catch(() => "threw");
    expect({ outcome, skipped }).toEqual({ outcome: "threw", skipped: [] });
  });
});

/** A cached plugin cannot import packages/, so its runner is a copy. These tests pin each copy to this one. */
describe("plugin runners", () => {
  const shape = (schema: z.ZodObject): Record<string, unknown> =>
    z
      .record(z.string(), z.unknown())
      .parse(
        JSON.parse(
          JSON.stringify(z.toJSONSchema(schema), (_, value: unknown) =>
            Array.isArray(value) && value.every((item) => typeof item === "string")
              ? value.toSorted()
              : value,
          ),
        ),
      );

  test.each<{ name: string; schema: z.ZodObject }>([
    { name: "writing", schema: WritingAlert },
    { name: "prompting", schema: PromptingAlert },
    { name: "vale, which adds Action for its fixes", schema: FixAlert.omit({ Action: true }) },
  ])("$name declares the same alert schema", ({ schema }) => {
    expect(shape(schema)).toEqual(shape(Alert));
  });

  type Run = (dir: string, file: File) => Promise<number>;
  const count = (alerts: Map<string, unknown[]>): number => [...alerts.values()].flat().length;
  const runners: Record<string, Run> = {
    runner: async (dir, file) => count(await lint([at(dir, file)], { config: config(dir) })),
    writing: async (dir, file) => (await lintFile(at(dir, file))).length,
    prompting: async (dir, file) =>
      count(await promptingLint([at(dir, file)], { config: config(dir) })),
    vale: async (dir, file) => count(await fixLint(config(dir), [at(dir, file)])),
  };

  test.each<{ name: string; dir: () => string; file: File; outcome: number | "threw" }>([
    { name: "exit 0", dir: good, file: "clean.md", outcome: 0 },
    { name: "exit 1", dir: good, file: "foo.md", outcome: 1 },
    { name: "exit 2", dir: broken, file: "clean.md", outcome: "threw" },
  ])("$name is handled alike", async ({ dir, file, outcome }) => {
    const outcomes = Object.fromEntries(
      await Promise.all(
        Object.entries(runners).map(async ([name, run]): Promise<[string, number | "threw"]> => [
          name,
          await run(dir(), file).catch(() => "threw" as const),
        ]),
      ),
    );
    expect(outcomes).toEqual(
      Object.fromEntries(Object.keys(runners).map((name) => [name, outcome])),
    );
  });
});
