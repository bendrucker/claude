import { z } from "zod";
import type { ValeAlert } from "../detection/vale";

const Hunk = z.object({ newStart: z.number(), lines: z.array(z.string()) });
const ToolResponse = z.looseObject({
  type: z.string().optional().catch(undefined),
  structuredPatch: z.array(Hunk).optional().catch(undefined),
});

/** Each line an edit added, by its 1-based number in the saved file, mapped to the index of its hunk. */
export interface EditScope {
  added: Map<number, number>;
  removed: string[];
}

/** The lines an Edit, MultiEdit, or overwriting Write changed. Null when the whole file counts as written. */
export function editScopeOf(toolResponse: unknown): EditScope | null {
  const response = ToolResponse.safeParse(toolResponse).data;
  if (response?.structuredPatch === undefined || response.type === "create") return null;
  const scope: EditScope = { added: new Map(), removed: [] };
  for (const [index, hunk] of response.structuredPatch.entries()) {
    scope.removed.push(
      hunk.lines
        .filter((line) => line.startsWith("-"))
        .map((line) => line.slice(1))
        .join("\n"),
    );
    let line = hunk.newStart;
    for (const text of hunk.lines) {
      if (text.startsWith("+")) scope.added.set(line, index);
      if (text.startsWith("+") || text.startsWith(" ")) line += 1;
    }
  }
  return scope;
}

function occurrences(text: string, match: string): number {
  return text.split(match).length - 1;
}

// A hunk's removed text is matched as a whole rather than line by line, so
// rewrapping a paragraph does not re-report a match that only moved lines.
/** Keep alerts on added lines, excusing one per match the line's hunk removed. */
export function editedAlerts(alerts: ValeAlert[], scope: EditScope): ValeAlert[] {
  const excused = new Map<string, number>();
  return alerts.filter((alert) => {
    const hunk = scope.added.get(alert.Line);
    if (hunk === undefined) return false;
    if (alert.Match === "") return true;
    const key = `${hunk}\0${alert.Check}\0${alert.Match}`;
    const used = excused.get(key) ?? 0;
    if (used >= occurrences(scope.removed[hunk] ?? "", alert.Match)) return true;
    excused.set(key, used + 1);
    return false;
  });
}
