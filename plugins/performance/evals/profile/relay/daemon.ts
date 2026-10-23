#!/usr/bin/env bun

// Runs `samply record` requests from a sandboxed eval session outside the sandbox, where samply
// can obtain the task port. Requests are files the session's `samply` stub writes into the queue.

import { readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

function parseArgs(): [string, string, string] {
  const [queue, root, samply] = process.argv.slice(2);
  if (queue === undefined || root === undefined || samply === undefined) {
    console.error("usage: daemon.ts <queue> <run-root> <samply>");
    process.exit(2);
  }
  return [queue, root, samply];
}

const [queue, root, samply] = parseArgs();
const deadline = Date.now() + 30 * 60 * 1000;
const rootPath = await realpath(root);

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of raw.split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

async function record(cwd: string, argv: string[], env: Record<string, string>) {
  const resolved = await realpath(cwd).catch(() => "");
  if (argv[0] !== "record")
    return {
      code: 2,
      out: "",
      err: "samply: only `samply record` and `samply --version` are available here\n",
    };
  if (!resolved.startsWith(`${rootPath}/`))
    return { code: 2, out: "", err: `samply: working directory ${cwd} is outside this session\n` };
  const proc = Bun.spawn([samply, ...argv], { cwd: resolved, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

async function serve(id: string): Promise<void> {
  const base = join(queue, id);
  const [cwd = "", ...argv] = (await Bun.file(`${base}.req`).text()).split("\0").slice(0, -1);
  const env = parseEnv(await Bun.file(`${base}.env`).text());
  await rm(`${base}.req`);
  const { code, out, err } = await record(cwd, argv, env);
  await Promise.all([Bun.write(`${base}.out`, out), Bun.write(`${base}.err`, err)]);
  // The stub waits for this file to be non-empty, so it is written last.
  await Bun.write(`${base}.code`, String(code));
}

// One profile at a time, so concurrent runs don't skew each other's samples.
async function serveAll(ids: string[]): Promise<void> {
  const [id, ...rest] = ids;
  if (id === undefined) return;
  await serve(id).catch(() => undefined);
  return serveAll(rest);
}

async function poll(): Promise<void> {
  const entries = await readdir(rootPath)
    .then(() => readdir(queue))
    .catch(() => undefined);
  if (entries === undefined || Date.now() > deadline) return;
  await serveAll(entries.filter((n) => n.endsWith(".req")).map((n) => n.slice(0, -".req".length)));
  await Bun.sleep(100);
  return poll();
}

await poll();
