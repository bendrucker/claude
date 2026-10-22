#!/usr/bin/env bun
// Publishes the session index to a DuckLake that remote readers query in place, and
// writes the init file those readers open it with. The work lives in lake/.
import { cli } from "cleye";
import { getDataDir, LOCAL_HOST, sessionDbPath } from "./db";
import { publish } from "./lake/publish";
import type { LakeOptions } from "./lake/store";
import { writeReaderInit } from "./lake/views";
import { checkpoint } from "./lake/writer";

if (import.meta.main) {
  const argv = cli({
    name: "lake",
    parameters: ["<command>"],
    help: {
      description:
        "publish: copy what changed in the local index to the lake. checkpoint: run DuckLake maintenance. init: print the path of a reader init file, for `duckdb -init`.",
    },
    flags: {
      url: {
        type: String,
        description:
          "Lake location, s3://bucket/prefix or a directory (default: $CLAUDE_SESSION_LAKE_URL)",
        default: process.env.CLAUDE_SESSION_LAKE_URL ?? "",
      },
      host: {
        type: [String],
        description: `Host to publish, repeatable (default: ${LOCAL_HOST})`,
      },
      stateDir: {
        type: String,
        description:
          "Where the writer keeps its catalog copy and spill files (default: the index dir)",
      },
    },
  });
  const url = argv.flags.url;
  if (url === "") throw new Error("Set --url or CLAUDE_SESSION_LAKE_URL.");
  const dataDir = getDataDir();
  const options: LakeOptions = {
    url,
    hosts: argv.flags.host.length > 0 ? argv.flags.host : [LOCAL_HOST],
    index: sessionDbPath(dataDir),
    stateDir: argv.flags.stateDir ?? dataDir,
  };
  switch (argv._.command) {
    case "publish":
      console.error(JSON.stringify(await publish(options)));
      break;
    case "checkpoint":
      await checkpoint(options);
      break;
    case "init":
      console.log(await writeReaderInit(url));
      break;
    default:
      throw new Error(`Unknown command: ${argv._.command}`);
  }
}
