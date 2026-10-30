#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: writes the catalog copy and spill files into the index dir,
// outside the sandbox's writable paths.
// Publishes the session index to a DuckLake that remote readers query in place, and
// writes the init file those readers open it with. The SQL under resources/lake/ does
// the work in the DuckDB CLI. This wrapper checks egress, moves the catalog to and from
// S3, and attaches the index and lake.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { $ } from "bun";
import { z } from "zod";
import { enumerateHosts, getDataDir, LOCAL_HOST, sessionDbPath } from "./db";
import { emit, errorClass } from "./events";
import { type QueryParams, renderSetVariables } from "./query";

const RESOURCES_DIR = join(import.meta.dirname, "..", "resources");
const LAKE_SQL = join(RESOURCES_DIR, "lake");

export interface LakeOptions {
  /** `s3://bucket/prefix` or a local directory, holding `catalog.ducklake` and `data/`. */
  url: string;
  /** Hosts to publish. Every other host stays local. */
  hosts: string[];
  /** The local index to publish from. */
  index: string;
  /** Where the writer keeps its copy of a remote catalog and spills. */
  stateDir: string;
  /** Imported hosts' root, for their egress policy. */
  importsDir?: string;
}

const isRemote = (url: string) => url.startsWith("s3://");
const catalogUrl = (url: string) => `${url.replace(/\/$/, "")}/catalog.ducklake`;
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const read = (path: string) => Bun.file(join(RESOURCES_DIR, path)).text();

// pullCatalog replaces a remote catalog's copy on every run, so lakes can share the path.
const localCatalog = (o: LakeOptions) =>
  isRemote(o.url) ? join(o.stateDir, "lake", "catalog.ducklake") : catalogUrl(o.url);

/** Refuses any host but local unless its import manifest allows egress. */
async function refuseBlockedHosts(o: LakeOptions): Promise<void> {
  const known = await enumerateHosts(
    o.importsDir === undefined ? {} : { importsDir: o.importsDir },
  );
  const allowed = (host: string) =>
    host === LOCAL_HOST || known.find((h) => h.host === host)?.policy.block_egress === false;
  const blocked = o.hosts.filter((h) => !allowed(h));
  if (blocked.length > 0)
    throw new Error(`Refusing to publish hosts not imported with --egress: ${blocked.join(", ")}`);
}

// Always starts from the remote catalog, so a stale copy from another machine or an
// earlier run never overwrites newer snapshots. Only a missing object starts a new lake.
async function pullCatalog(o: LakeOptions): Promise<void> {
  const local = localCatalog(o);
  mkdirSync(dirname(local), { recursive: true });
  await rm(local, { force: true });
  const listed = await $`aws s3 ls ${catalogUrl(o.url)}`.nothrow().quiet();
  if (listed.exitCode === 0) await $`aws s3 cp --only-show-errors ${catalogUrl(o.url)} ${local}`;
  else if (listed.exitCode !== 1 || listed.stderr.length > 0)
    throw new Error(`aws s3 ls ${catalogUrl(o.url)} failed: ${listed.stderr.toString().trim()}`);
}

/** Runs `script` in the DuckDB CLI with the index and lake attached, and returns stdout. */
async function runWriter(options: LakeOptions, script: string): Promise<string> {
  // The CLI runs from a scratch dir, so every local path must be absolute.
  const o = {
    ...options,
    url: isRemote(options.url) ? options.url : resolve(options.url),
    index: resolve(options.index),
    stateDir: resolve(options.stateDir),
  };
  if (isRemote(o.url)) await pullCatalog(o);
  else mkdirSync(join(o.url, "data"), { recursive: true });
  mkdirSync(join(o.stateDir, "lake"), { recursive: true });
  const work = mkdtempSync(join(o.stateDir, "lake", "run-"));
  const header = [
    `.read ${join(LAKE_SQL, "writer.sql")}`,
    isRemote(o.url) ? `.read ${join(LAKE_SQL, "s3.sql")}` : "",
    `ATTACH ${quote(o.index)} AS idx (READ_ONLY);`,
    `ATTACH ${quote(`ducklake:${localCatalog(o)}`)} AS lake (DATA_PATH ${quote(`${o.url.replace(/\/$/, "")}/data/`)});`,
    `SET VARIABLE hosts = [${o.hosts.map(quote).join(", ")}]::VARCHAR[];`,
    `.read ${join(LAKE_SQL, script)}`,
  ].join("\n");
  try {
    const out = await $`duckdb -no-agent -bail :memory: < ${Buffer.from(header)}`.cwd(work).quiet();
    return out.stdout.toString();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function pushCatalog(o: LakeOptions): Promise<void> {
  if (isRemote(o.url))
    await $`aws s3 cp --only-show-errors ${localCatalog(o)} ${catalogUrl(o.url)}`;
}

const PublishResult = z.object({
  files: z.number(),
  sessions: z.number(),
  macros: z.number(),
  rebuilt: z.boolean(),
});
export type PublishResult = z.infer<typeof PublishResult>;

/**
 * One DuckLake commit of what changed since the last publish. A remote catalog is
 * uploaded only after the commit, and its Parquet files are immutable, so a reader sees
 * the previous snapshot or this one.
 */
export async function publish(o: LakeOptions): Promise<PublishResult> {
  await refuseBlockedHosts(o);
  const out = (await runWriter(o, "publish.sql")).trim().split("\n").at(-1) ?? "";
  const result = PublishResult.parse(JSON.parse(out));
  if (result.files > 0 || result.macros > 0 || result.rebuilt) await pushCatalog(o);
  return result;
}

export async function checkpoint(o: LakeOptions): Promise<void> {
  await runWriter(o, "checkpoint.sql");
  await pushCatalog(o);
}

/**
 * What a reader runs before its query: limits and the read-only attach. Tables and macros
 * all live in the lake, which unqualified names resolve to.
 */
export async function readerInit(url: string): Promise<string> {
  return [
    await read("limits.sql"),
    isRemote(url) ? await read("lake/s3.sql") : "",
    "INSTALL ducklake; LOAD ducklake;",
    // The lake's macros carry the arrow lambdas DuckDB prints them with (writer.sql).
    "SET lambda_syntax = 'ENABLE_SINGLE_ARROW';",
    `ATTACH ${quote(`ducklake:${catalogUrl(url)}`)} AS lake (READ_ONLY);`,
    "SET search_path = 'memory.main,lake.main';",
  ].join("\n");
}

const ScanPlan = z.object({
  name: z.string(),
  extra_info: z.record(z.string(), z.unknown()).optional(),
  get children() {
    return z.array(ScanPlan).default([]);
  },
});
type ScanPlan = z.infer<typeof ScanPlan>;

/** Every DuckLake scan in an EXPLAIN (FORMAT json) plan, with its columns and filter text. */
export function lakeScans(
  plan: unknown,
): { id: number; tbl: string; projections: string[]; filters: string | null }[] {
  const scans: ScanPlan[] = [];
  const pending = z.array(ScanPlan).parse(plan);
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.name === "DUCKLAKE_SCAN") scans.push(node);
    pending.push(...node.children);
  }
  return scans.map((s, id) => {
    const info = z
      .object({
        Table: z.string(),
        Projections: z.union([z.string(), z.array(z.string())]).optional(),
        Filters: z.union([z.string(), z.array(z.string())]).optional(),
      })
      .parse(s.extra_info);
    return {
      id,
      tbl: info.Table.split(".").at(-1) ?? info.Table,
      projections: list(info.Projections),
      filters: info.Filters === undefined ? null : list(info.Filters).join(" AND "),
    };
  });
}

const list = (v?: string | string[]) => (v === undefined ? [] : [v].flat());

const Estimate = z.array(
  z.object({ id: z.number(), tbl: z.string(), files: z.coerce.number(), bytes: z.coerce.number() }),
);

export interface LakeQueryResult {
  rows: unknown[];
  /** Data bytes the plan's scans could read, by the catalog's stats. */
  estimate: number;
  /** What the catalog fetches came to, for the attach and the query's planning. */
  catalogBytes: number;
  gets: number;
  /** Every byte the process fetched, the catalog included. */
  bytes: number;
}

const MB = 1024 * 1024;

/**
 * Runs `sql` against the lake in-process, refusing it when the catalog's stats put its
 * data reads above `maxBytes`. The node client has no getenv, so a macro over the
 * environment stands in for the variables the init reads.
 */
export async function queryLake(
  url: string,
  sql: string,
  maxBytes: number,
  params: QueryParams = {},
): Promise<LakeQueryResult> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0)
    throw new Error(`The budget must be a nonnegative number of bytes, got ${maxBytes}.`);
  const instance = await DuckDBInstance.create(":memory:");
  const c = await instance.connect();
  try {
    const init = await readerInit(url);
    const names = [...new Set([...init.matchAll(/getenv\('(\w+)'\)/g)].map((m) => m[1] ?? ""))];
    const env = names.map((n) => `${quote(n)}: ${quote(process.env[n] ?? "")}`).join(", ");
    await c.run(`CREATE TEMP MACRO getenv(name) AS coalesce(MAP {${env}}[name], '')`);
    await c.run("CALL enable_logging('HTTP', storage = 'memory')");
    await c.run(init);

    // One statement, so the plan priced is the query that runs. Variables come as params.
    if ((await c.extractStatements(sql)).count !== 1)
      throw new Error("Pass one statement, with any variables as --param name=value.");
    const vars = renderSetVariables(params);
    if (vars !== "") await c.run(vars);
    const explained = (await c.runAndReadAll(`EXPLAIN (FORMAT json) ${sql}`)).getRowObjectsJS();
    const plan = explained.flatMap((r) =>
      z.array(z.unknown()).parse(JSON.parse(z.string().parse(r.explain_value))),
    );
    await c.run(`SET VARIABLE scans = ${quote(JSON.stringify(lakeScans(plan)))}`);
    const scans = Estimate.parse(
      (await c.runAndReadAll(await read("lake/estimate.sql"))).getRowObjectsJS(),
    );
    // The estimator's variables share the caller's namespace, so the caller's are restored.
    await c.run("RESET VARIABLE scans; RESET VARIABLE comparison;");
    if (vars !== "") await c.run(vars);
    const estimate = scans.reduce((n, s) => n + s.bytes, 0);
    if (estimate > maxBytes) {
      const top = scans
        .slice(0, 3)
        .map((s) => `${s.tbl} ${(s.bytes / MB).toFixed(1)} MB in ${s.files} files`)
        .join(", ");
      throw new LakeBudgetError(
        `Estimated ${(estimate / MB).toFixed(1)} MB of lake reads, above the ${(maxBytes / MB).toFixed(0)} MB budget (${top}). Narrow the date window or the columns, or pass a larger --max-mb.`,
        estimate,
        await fetchedBytes(c),
      );
    }

    const rows = (await c.runAndReadAll(sql)).getRowObjectsJS();
    return { rows, estimate, ...(await fetchedBytes(c)) };
  } finally {
    c.closeSync();
    instance.closeSync();
  }
}

type Fetched = Pick<LakeQueryResult, "gets" | "bytes" | "catalogBytes">;

async function fetchedBytes(c: DuckDBConnection): Promise<Fetched> {
  return z
    .object({
      gets: z.coerce.number(),
      bytes: z.coerce.number(),
      catalogBytes: z.coerce.number(),
    })
    .parse(
      (
        await c.runAndReadAll(
          `SELECT count(*) AS gets, coalesce(sum(n), 0) AS bytes,
                coalesce(sum(n) FILTER (WHERE request.url LIKE '%/catalog.ducklake'), 0) AS "catalogBytes"
              FROM (SELECT *, TRY_CAST(response.headers['Content-Length'] AS BIGINT) AS n
                FROM duckdb_logs_parsed('HTTP') WHERE request.type = 'GET')`,
        )
      ).getRowObjectsJS()[0],
    );
}

export class LakeBudgetError extends Error {
  constructor(
    message: string,
    readonly estimate: number,
    readonly fetched: Fetched,
  ) {
    super(message);
    this.name = "LakeBudgetError";
  }
}

/**
 * Writes the reader init for `url` and returns its path. duckdb -init runs the file, so it
 * lives in a directory only this user can write, named by its content so readers of
 * different lakes never share one.
 */
async function writeReaderInit(url: string): Promise<string> {
  const dir = join(tmpdir(), `claude-session-lake-${process.getuid?.() ?? "user"}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = await Bun.file(dir).stat();
  if (st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0)
    throw new Error(`${dir} is not private to this user; remove it and retry.`);
  const sql = await readerInit(url);
  const path = join(dir, `${createHash("sha256").update(sql).digest("hex").slice(0, 12)}.sql`);
  if (!(await Bun.file(path).exists())) {
    // Renamed into place, so a concurrent reader never opens a partial file.
    await Bun.write(`${path}.${process.pid}`, sql);
    await $`mv -f ${`${path}.${process.pid}`} ${path}`;
  }
  return path;
}

if (import.meta.main) {
  const program = new Command("lake.ts")
    .description("Publish the session index to a DuckLake that remote readers query in place.")
    .option(
      "--url <url>",
      "Lake location, s3://bucket/prefix or a directory (default: $CLAUDE_SESSION_LAKE_URL)",
    )
    .option("--host <host...>", "Hosts to publish", [LOCAL_HOST])
    .option(
      "--state-dir <dir>",
      "Where the writer keeps its catalog copy and spill files (default: the index dir)",
    );
  const options = (): LakeOptions => {
    const o = program.opts();
    const url = o.url ?? process.env.CLAUDE_SESSION_LAKE_URL ?? "";
    if (url === "") throw new Error("Set --url or CLAUDE_SESSION_LAKE_URL.");
    const dataDir = getDataDir();
    return {
      url,
      hosts: o.host,
      index: sessionDbPath(dataDir),
      stateDir: o.stateDir ?? dataDir,
    };
  };
  program
    .command("publish")
    .description("Copy what changed in the local index to the lake")
    .action(async () => {
      console.error(JSON.stringify(await publish(options())));
    });
  program
    .command("checkpoint")
    .description("Run DuckLake's CHECKPOINT")
    .action(() => checkpoint(options()));
  program
    .command("query")
    .description("Run SQL against the lake, refusing it when its estimated reads exceed a budget")
    .argument("[sql]", "One SQL statement")
    .option("--name <query>", "A named query from resources/queries, in place of SQL")
    .option(
      "--param <name=value>",
      "A variable to set first, read with getvariable(). Repeatable",
      (kv: string, all: string[]) => {
        if (!/^\w+=/.test(kv)) throw new Error(`--param takes name=value, got ${kv}`);
        return [...all, kv];
      },
      [],
    )
    .option("--max-mb <mb>", "Budget for the estimated data reads, in MiB", "256")
    .action(async (text, o) => {
      if ((text === undefined) === (o.name === undefined))
        throw new Error("Pass SQL or --name, not both.");
      const sql = text ?? (await read(join("queries", `${o.name}.sql`)));
      const params = Object.fromEntries(
        o.param.map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]),
      );
      const maxMb = Number(o.maxMb);
      if (!Number.isFinite(maxMb) || maxMb < 0)
        throw new Error(`--max-mb takes a number of MiB, got ${o.maxMb}`);
      const started = performance.now();
      const url = options().url;
      // The summary also lands in the transcript, which is how a cloud session's spend
      // reaches the index.
      const report = (f: Fetched, estimate: number) => {
        console.error(
          `lake: read ${(f.bytes / MB).toFixed(1)} MB in ${f.gets} GETs, ${(f.catalogBytes / MB).toFixed(1)} MB of it the catalog (data estimate ${(estimate / MB).toFixed(1)} MB)`,
        );
      };
      try {
        const r = await queryLake(url, sql, maxMb * MB, params);
        console.log(
          JSON.stringify(r.rows, (_, v: unknown) => (typeof v === "bigint" ? Number(v) : v)),
        );
        report(r, r.estimate);
        await emit({
          event: "query",
          ok: true,
          ms: performance.now() - started,
          detail: {
            name: o.name ?? "adhoc",
            adapter: "lake",
            caller: "session/lake.ts",
            rows: r.rows.length,
            estimate_bytes: r.estimate,
            gets: r.gets,
            http_bytes: r.bytes,
            catalog_bytes: r.catalogBytes,
          },
        });
      } catch (error) {
        const detail: Record<string, unknown> = {
          name: o.name ?? "adhoc",
          adapter: "lake",
          caller: "session/lake.ts",
          error: errorClass(error),
        };
        if (error instanceof LakeBudgetError) {
          detail.error = "over budget";
          detail.estimate_bytes = error.estimate;
          detail.gets = error.fetched.gets;
          detail.http_bytes = error.fetched.bytes;
          detail.catalog_bytes = error.fetched.catalogBytes;
          report(error.fetched, error.estimate);
        }
        await emit({ event: "query", ok: false, ms: performance.now() - started, detail });
        throw error;
      }
    });
  program
    .command("init")
    .description("Print the path of a reader init file, for duckdb -init")
    .action(async () => {
      console.log(await writeReaderInit(options().url));
    });
  await program.parseAsync();
}
