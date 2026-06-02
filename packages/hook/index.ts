import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export async function runHook<I, O>(
  handler: (input: I) => O | null | Promise<O | null>,
  label: string,
): Promise<void> {
  let input: I;
  try {
    input = await readStdinJson<I>();
  } catch (error) {
    console.error(
      `[${label}] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const result = await handler(input);
  if (result) {
    writeStdoutJson(result);
  }
}
