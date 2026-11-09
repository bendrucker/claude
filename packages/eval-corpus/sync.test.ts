import { CommanderError, type CommandUnknownOpts } from "@commander-js/extra-typings";
import { expect, test } from "bun:test";
import type { Corpus } from "./bucket";
import { s3 } from "./storage";
import { syncCommand } from "./sync";

function harness(corpus: Omit<Corpus, "description">) {
  const calls: string[][] = [];
  let pulled = 0;
  const command = syncCommand(
    {
      description: "the test corpus",
      afterPull: () => {
        pulled++;
        return Promise.resolve();
      },
      ...corpus,
    },
    (options) =>
      s3({
        ...options,
        run: (args) => {
          calls.push(args);
          return Promise.resolve();
        },
      }),
  );
  let output = "";
  const capture = (text: string): void => {
    output += text;
  };
  const configure = (cmd: CommandUnknownOpts): void => {
    cmd.exitOverride().configureOutput({ writeOut: capture, writeErr: capture });
    for (const sub of cmd.commands) configure(sub);
  };
  configure(command);
  return {
    calls,
    pulled: () => pulled,
    output: () => output,
    run: async (argv: string[]) => command.parseAsync(argv, { from: "user" }),
  };
}

const corpus = {
  prefix: "suite",
  mirrors: [
    { local: "/a", remote: "a" },
    { local: "/b", filters: [{ include: "x" }] },
  ],
};

function profileOf(args: string[]): string | undefined {
  const at = args.indexOf("--profile");
  return at === -1 ? undefined : args[at + 1];
}

test.each<{ argv: string[]; profile: string | undefined }>([
  { argv: ["pull"], profile: "agents" },
  { argv: ["push"], profile: "agents-admin" },
  { argv: ["push", "--profile", "other"], profile: "other" },
  { argv: ["pull", "--no-profile"], profile: undefined },
  { argv: ["push", "--no-profile"], profile: undefined },
])("$argv runs under profile $profile", async ({ argv, profile }) => {
  const { calls, run } = harness(corpus);
  await run(argv);
  expect(calls).toHaveLength(2);
  for (const args of calls) expect(profileOf(args)).toBe(profile);
});

test("each mirror syncs with exactly its own filters", async () => {
  const { calls, run } = harness(corpus);
  await run(["pull"]);
  expect(calls.map((args) => args.slice(2, -2))).toEqual([
    ["s3://ben-drucker-agents-eval-corpus/suite/a", "/a"],
    ["s3://ben-drucker-agents-eval-corpus/suite", "/b", "--include", "x"],
  ]);
});

test.each<{ argv: string[]; pulled: number }>([
  { argv: ["pull"], pulled: 1 },
  { argv: ["pull", "--dry-run"], pulled: 0 },
  { argv: ["push"], pulled: 0 },
])("$argv runs afterPull $pulled times", async ({ argv, pulled }) => {
  const h = harness(corpus);
  await h.run(argv);
  expect(h.pulled()).toBe(pulled);
});

test("an unknown direction exits through CommanderError", async () => {
  const h = harness(corpus);
  const failure = await h.run(["sideways"]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CommanderError);
  expect(h.output()).toContain("sideways");
});
