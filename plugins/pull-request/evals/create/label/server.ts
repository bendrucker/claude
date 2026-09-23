#!/usr/bin/env bun
import { basename, join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";

// Serves hand labels for a run's llm grader verdicts, so judge agreement can be measured.

const argv = cli({
  name: "label-server",
  parameters: ["<run dir>"],
  flags: {
    port: { type: Number, default: 4320, description: "Port to listen on" },
    labels: {
      type: String,
      default: join(import.meta.dirname, "..", "labels.json"),
      description: "Labels file, keyed by run and sample",
    },
  },
});
const runDir = argv._.runDir;
const values = argv.flags;

const Result = z.object({
  cases: z.array(
    z.object({
      name: z.string(),
      promptMarkdown: z.string(),
      arms: z.record(
        z.string(),
        z.array(
          z.object({
            graders: z.array(
              z.object({ name: z.string(), passed: z.boolean(), explanation: z.string() }),
            ),
          }),
        ),
      ),
    }),
  ),
});
const TraceEvent = z.looseObject({ type: z.string().optional(), result: z.string().optional() });
const Labels = z.record(z.string(), z.unknown());
const LabelPost = z.object({ id: z.string(), label: z.record(z.string(), z.unknown()) });

const suite = join(import.meta.dirname, "..");
const repo = Bun.spawnSync(["git", "-C", suite, "rev-parse", "--show-toplevel"])
  .stdout.toString()
  .trim();

// Criteria come from HEAD so a label records what the judge was asked, even while graders are edited.
function committedCriteria(caseName: string, grader: string): string | undefined {
  const rel = join(suite, caseName, "graders", `${grader}.md`).slice(repo.length + 1);
  const out = Bun.spawnSync(["git", "-C", repo, "show", `HEAD:${rel}`]);
  const source = out.stdout.toString();
  if (!out.success || !/^type: llm$/m.test(source)) return undefined;
  return source.replace(/^---[\s\S]*?---\n/, "").trim();
}

function finalBody(trace: string): string {
  const events = trace
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => TraceEvent.parse(JSON.parse(line)));
  return events.findLast((e) => e.type === "result")?.result ?? "";
}

const result = Result.parse(await Bun.file(join(runDir, "result.json")).json());
const entries = result.cases.flatMap((c) =>
  Object.entries(c.arms).flatMap(([arm, runs]) => runs.map((run, i) => ({ c, arm, run, i }))),
);
const samples = await Promise.all(
  entries.map(async ({ c, arm, run, i }) => {
    const id = `${c.name}-${arm}-${i}`;
    const graders = run.graders.flatMap((g) => {
      const criteria = committedCriteria(c.name, g.name);
      return criteria === undefined
        ? []
        : [{ name: g.name, criteria, judge: g.passed, votes: g.explanation }];
    });
    const trace = await Bun.file(join(runDir, "traces", `${id}.jsonl`)).text();
    const fired = run.graders.find((g) => g.name === "skill-fired")?.passed ?? false;
    return {
      id,
      case: c.name,
      arm,
      fired,
      prompt: c.promptMarkdown,
      body: finalBody(trace),
      graders,
    };
  }),
);

const labelsFile = Bun.file(values.labels);
async function readLabels(): Promise<Record<string, unknown>> {
  return (await labelsFile.exists()) ? Labels.parse(await labelsFile.json()) : {};
}
const run = basename(runDir);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: values.port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/") return new Response(Bun.file(join(import.meta.dirname, "index.html")));
    if (pathname === "/api/samples") return Response.json({ run, samples });
    if (pathname === "/api/labels" && req.method === "GET")
      return Response.json(await readLabels());
    if (pathname === "/api/labels" && req.method === "POST") {
      const post = LabelPost.safeParse(await req.json());
      if (!post.success) return new Response(z.prettifyError(post.error), { status: 400 });
      const { id, label } = post.data;
      if (!samples.some((s) => s.id === id)) return new Response("unknown sample", { status: 400 });
      const labels = await readLabels();
      labels[`${run}/${id}`] = { ...label, run, sample: id };
      await Bun.write(values.labels, `${JSON.stringify(labels, null, 2)}\n`);
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`Labeler: http://127.0.0.1:${server.port} (${samples.length} bodies from ${run})`);
console.log(`Labels:  ${values.labels}`);
