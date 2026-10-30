import { z } from "zod";
import type { ValeAlert } from "../detection/vale";

const Hunk = z.object({ newStart: z.number(), lines: z.array(z.string()) });
const ToolResponse = z.looseObject({
  type: z.string().optional().catch(undefined),
  originalFile: z.string().nullable().optional().catch(undefined),
  structuredPatch: z.array(Hunk).optional().catch(undefined),
});

export interface EditScope {
  /** The file's content before the edit. */
  original: string;
  /** The 1-based numbers of the lines the edit added, in the saved file. */
  added: Set<number>;
}

/** What an Edit, MultiEdit, or overwriting Write replaced. Null when the whole file counts as written. */
export function editScopeOf(toolResponse: unknown): EditScope | null {
  const response = ToolResponse.safeParse(toolResponse).data;
  if (response === undefined || response.type === "create") return null;
  if (typeof response.originalFile !== "string") return null;
  const added = new Set<number>();
  for (const hunk of response.structuredPatch ?? []) {
    let line = hunk.newStart;
    for (const text of hunk.lines) {
      if (text.startsWith("+")) added.add(line);
      if (text.startsWith("+") || text.startsWith(" ")) line += 1;
    }
  }
  return { original: response.originalFile, added };
}

function keyOf(alert: ValeAlert): string {
  return `${alert.Check}\0${alert.Match}`;
}

// Alerts pair by check and matched text rather than position, so paragraph and
// document checks that report away from the edit, and text the edit moved, still pair.
/** Alerts in `after` beyond those `before` raised, reporting the ones on added lines first. */
export function newAlerts(
  after: ValeAlert[],
  before: ValeAlert[],
  added: Set<number>,
): ValeAlert[] {
  const excuses = new Map<string, number>();
  for (const alert of before) excuses.set(keyOf(alert), (excuses.get(keyOf(alert)) ?? 0) + 1);
  const offEdit = after.toSorted((a, b) => Number(added.has(a.Line)) - Number(added.has(b.Line)));
  const kept = new Set<ValeAlert>();
  for (const alert of offEdit) {
    const left = excuses.get(keyOf(alert)) ?? 0;
    if (left > 0) excuses.set(keyOf(alert), left - 1);
    else kept.add(alert);
  }
  return after.filter((alert) => kept.has(alert));
}
