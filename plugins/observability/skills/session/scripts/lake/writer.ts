// The writer's connection: the local index attached read-only beside the lake, and
// DuckLake's own maintenance over it.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import {
  isRemote,
  type LakeOptions,
  localCatalog,
  proxySettings,
  pullCatalog,
  pushCatalog,
  quote,
  s3Setup,
  trimmed,
} from "./store";

// Rows sorted by time in small row groups, so a window filter skips most of a file.
const ROW_GROUP_SIZE = "8192";

const Count = z.object({ n: z.union([z.bigint(), z.number()]) });

export interface Writer {
  run(sql: string): Promise<void>;
  rows<T>(sql: string, schema: z.ZodType<T>): Promise<T[]>;
  /** Runs each statement in order on the one connection. */
  script(statements: string[]): Promise<void>;
  count(sql: string): Promise<number>;
  close(): void;
}

export async function connect(o: LakeOptions): Promise<Writer> {
  // An in-memory instance has no spill dir by default.
  const spill = join(o.stateDir, "lake", "tmp");
  mkdirSync(spill, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:", {
    memory_limit: "4GiB",
    threads: "4",
    temp_directory: spill,
    max_temp_directory_size: "32GiB",
  });
  const c = await instance.connect();
  const run = async (sql: string) => {
    await c.run(sql);
  };
  const rows = async <T>(sql: string, schema: z.ZodType<T>) =>
    z.array(schema).parse((await c.runAndReadAll(sql)).getRowObjectsJS());
  if (isRemote(o.url)) await run(s3Setup(proxySettings()));
  else mkdirSync(join(o.url, "data"), { recursive: true });
  mkdirSync(dirname(localCatalog(o)), { recursive: true });
  await run("INSTALL ducklake; LOAD ducklake;");
  await run(`ATTACH ${quote(o.index)} AS idx (READ_ONLY)`);
  await run(
    `ATTACH ${quote(`ducklake:${localCatalog(o)}`)} AS lake (DATA_PATH ${quote(`${trimmed(o.url)}/data/`)})`,
  );
  await run(`CALL lake.set_option('parquet_row_group_size', ${quote(ROW_GROUP_SIZE)})`);
  return {
    run,
    rows,
    async script(statements: string[]) {
      for (const sql of statements)
        // oxlint-disable-next-line no-await-in-loop -- one connection, and each statement reads the last one's writes.
        await run(sql);
    },
    count: async (sql: string) => Number((await rows(sql, Count))[0]?.n ?? 0),
    close() {
      c.closeSync();
      instance.closeSync();
    },
  };
}

/**
 * DuckLake's own maintenance: flush inlined rows, merge small files, expire snapshots
 * older than `olderThan`, and delete the files only those snapshots referenced. The
 * window must outlast the longest reader, which may still be reading an expired one.
 */
export async function checkpoint(o: LakeOptions, olderThan = "7 days"): Promise<void> {
  if (isRemote(o.url)) await pullCatalog(o);
  const db = await connect(o);
  try {
    await db.run(`CALL lake.set_option('expire_older_than', ${quote(olderThan)})`);
    await db.run(`CALL lake.set_option('delete_older_than', ${quote(olderThan)})`);
    await db.run("USE lake; CHECKPOINT;");
  } finally {
    db.close();
  }
  if (isRemote(o.url)) await pushCatalog(o);
}
