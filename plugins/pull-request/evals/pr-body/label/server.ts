#!/usr/bin/env bun

import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import {
  Feedback,
  feedbackEndpoint,
  fileResponse,
} from "../../../../../packages/eval-corpus/label";

// Serves the review UI, hands the browser the mined samples, and persists reviewer
// feedback to feedback/<id>.json for a later analysis pass.

export interface ServerOptions {
  dataPath: string;
  feedbackDir: string;
}

export function createHandler(opts: ServerOptions): (req: Request) => Promise<Response> {
  const feedback = feedbackEndpoint(opts.feedbackDir, Feedback, (body) => body.feedback);
  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html")
      return fileResponse(join(import.meta.dirname, "index.html"), "text/html; charset=utf-8");
    if (url.pathname === "/api/samples") return fileResponse(opts.dataPath, "application/json");
    if (url.pathname === "/api/feedback" && req.method === "GET") return feedback.get();
    if (url.pathname === "/api/feedback" && req.method === "POST") return feedback.post(req);
    return new Response("not found", { status: 404 });
  };
}

function port(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

export const program = new Command("label-server")
  .description("Label mined PR bodies in a browser.")
  .option("--port <n>", "Port to listen on", port, 4319)
  .option(
    "--data <path>",
    "Mined samples to review",
    join(import.meta.dirname, "..", "data", "samples.json"),
  )
  .option(
    "--feedback <dir>",
    "Directory for saved feedback",
    join(import.meta.dirname, "..", "feedback"),
  )
  .action((options) => {
    const server = Bun.serve({
      port: options.port,
      fetch: createHandler({ dataPath: options.data, feedbackDir: options.feedback }),
    });
    console.log(`Labeling UI: http://localhost:${server.port}`);
    console.log(`Samples:     ${options.data}`);
    console.log(`Feedback:    ${options.feedback}/`);
  });

if (import.meta.main) {
  await program.parseAsync();
}
