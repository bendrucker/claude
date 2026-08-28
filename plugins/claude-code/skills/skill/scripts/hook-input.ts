import { z } from "zod";

export const HookInput = z.looseObject({
  tool_name: z.string().catch(""),
  tool_input: z.unknown(),
});
export type HookInput = z.infer<typeof HookInput>;

const FileInput = z.looseObject({ file_path: z.string().optional().catch(undefined) });

export function filePathOf(toolInput: unknown): string | undefined {
  return FileInput.safeParse(toolInput).data?.file_path;
}
