import * as p from "@clack/prompts";
import type { PluginEntry } from "./plugins";
import { buildPrompt } from "./prompt";
import type { LaunchConfig } from "./schema";
import { schema } from "./schema";

export async function analyze(
  task: string,
  plugins: PluginEntry[],
  options?: { model?: string; followUp?: string },
): Promise<LaunchConfig> {
  const prompt = options?.followUp
    ? `${buildPrompt(task, plugins)}\n\n## Follow-up\n\n${options.followUp}`
    : buildPrompt(task, plugins);

  const s = p.spinner();
  s.start("Analyzing task...");

  const result = Bun.spawnSync(
    [
      "claude",
      "-p",
      "--model",
      "haiku",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--json-schema",
      JSON.stringify(schema),
      prompt,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  s.stop("Analysis complete");

  if (result.exitCode !== 0) {
    p.cancel("claude -p failed");
    console.error(result.stderr.toString());
    process.exit(1);
  }

  const output = JSON.parse(result.stdout.toString());
  return {
    ...output,
    ...(options?.model ? { model: options.model } : {}),
  };
}
