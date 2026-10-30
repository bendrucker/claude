import { z } from "zod";
import type { ValeAlert } from "../detection/vale";

const Hunk = z.object({ newStart: z.number(), lines: z.array(z.string()) });
const ToolResponse = z.looseObject({
  type: z.string().optional().catch(undefined),
  structuredPatch: z.array(Hunk).optional().catch(undefined),
});

/** Each line an edit added, by its 1-based number in the saved file, mapped to the text its hunk removed. */
export type EditScope = Map<number, string>;

/** The lines an Edit, MultiEdit, or overwriting Write changed. Null when the whole file counts as written. */
export function editScopeOf(toolResponse: unknown): EditScope | null {
  const response = ToolResponse.safeParse(toolResponse).data;
  if (response?.structuredPatch === undefined || response.type === "create") return null;
  const scope: EditScope = new Map();
  for (const hunk of response.structuredPatch) {
    const removed = hunk.lines
      .filter((line) => line.startsWith("-"))
      .map((line) => line.slice(1))
      .join("\n");
    let line = hunk.newStart;
    for (const text of hunk.lines) {
      if (text.startsWith("+")) scope.set(line, removed);
      if (text.startsWith("+") || text.startsWith(" ")) line += 1;
    }
  }
  return scope;
}

/** Whether the edit wrote `alert`: it sits on an added line and the replaced text did not already match it. */
export function inScope(alert: ValeAlert, scope: EditScope): boolean {
  const removed = scope.get(alert.Line);
  if (removed === undefined) return false;
  return alert.Match === "" || !removed.includes(alert.Match);
}
