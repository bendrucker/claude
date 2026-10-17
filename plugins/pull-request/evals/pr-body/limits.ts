import { GUARDS, LIMITS, guardKeys, limitKeys, measureStructure } from "./structure";

// The verdict lines the eval-stubs gh and glab print for each create or edit body, which the
// create suites' regex graders read off the trace.

const CHECKS = { ...LIMITS, ...GUARDS };
type CheckKey = keyof typeof CHECKS;

export const ROWS = {
  visibleWords: "visible-words",
  maxBlockWords: "max-block",
  proseCodeSpans: "prose-code-spans",
  pathSpans: "path-spans",
  contrastPhrases: "contrast-phrases",
  hiddenWords: "hidden-words",
  maxItemsPerList: "list-items",
} as const satisfies Record<CheckKey, string>;

const checkKeys: CheckKey[] = [...limitKeys, ...guardKeys];

/** One `PR-LIMIT <row>=pass|fail (<measured> of <limit>)` line per limit and guard. */
export default function limitLines(body: string): string[] {
  const s = measureStructure(body);
  return checkKeys.map(
    (key) =>
      `PR-LIMIT ${ROWS[key]}=${s[key] <= CHECKS[key] ? "pass" : "fail"} (${s[key]} of ${CHECKS[key]})`,
  );
}
