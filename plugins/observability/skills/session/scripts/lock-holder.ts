import { sessionDbPath } from "./db";

export interface HeldLock {
  release(): Promise<void>;
}

// DuckDB's file lock is per process, so only a second process can take one that the
// process under test contends with.
export async function holdLock(
  dataDir: string,
  mode: "READ_ONLY" | "READ_WRITE",
): Promise<HeldLock> {
  const code = `
    import { DuckDBInstance } from "@duckdb/node-api";
    const instance = await DuckDBInstance.create(${JSON.stringify(sessionDbPath(dataDir))}, { access_mode: ${JSON.stringify(mode)} });
    const connection = await instance.connect();
    console.log("ready");
    setInterval(() => [instance, connection], 60_000);
  `;
  const proc = Bun.spawn(["bun", "-e", code], {
    cwd: import.meta.dirname,
    stdout: "pipe",
    stderr: "inherit",
  });
  const { value } = await proc.stdout.getReader().read();
  if (!new TextDecoder().decode(value).includes("ready")) {
    proc.kill();
    throw new Error("lock holder exited before taking the lock");
  }
  return {
    async release() {
      proc.kill();
      await proc.exited;
    },
  };
}
