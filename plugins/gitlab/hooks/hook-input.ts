import { z } from "zod";

export const BashHookInput = z.looseObject({
  tool_input: z.looseObject({ command: z.string().optional().catch(undefined) }).catch({}),
});

// A hook that dies on an unreadable or undecodable payload takes the tool call
// down with it, so every failure reaching stdin is reported on stderr and the
// hook exits without output.
export async function readHookInput<S extends z.ZodType>(
  schema: S,
  hook: string,
): Promise<z.output<S> | null> {
  try {
    return schema.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[gitlab/${hook}] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
