import { z } from "zod";

export const BashHookInput = z.looseObject({
  tool_input: z.looseObject({ command: z.string().optional().catch(undefined) }).catch({}),
});

// A hook that dies on an undecodable payload takes the tool call down with it,
// so the failure is reported on stderr and the hook exits without output.
export function parseHookInput<S extends z.ZodType>(
  schema: S,
  hook: string,
  text: string,
): z.output<S> | null {
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    console.error(
      `[gitlab/${hook}] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
