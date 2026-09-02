import { z } from "zod";
import { decodeStdin } from "../../packages/decode/index";

// Every envelope field the user hooks read, plus the payload they decode
// separately. A hook that cannot parse its own stdin stops firing, so the
// envelope falls back rather than rejecting. Events other than PreToolUse
// carry no tool fields at all.
export const HookInput = z.looseObject({
  session_id: z.string().catch(""),
  hook_event_name: z.string().catch(""),
  transcript_path: z.string().optional().catch(undefined),
  tool_name: z.string().optional().catch(undefined),
  tool_input: z.unknown().optional(),
});
export type HookInput = z.infer<typeof HookInput>;

export function readHookInput(hook: string): Promise<HookInput> {
  return decodeStdin(HookInput, `${hook} stdin`);
}
