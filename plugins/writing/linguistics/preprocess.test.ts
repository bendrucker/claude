import { describe, expect, it } from "bun:test";
import { preprocessHeading } from "./preprocess";
import { CODE_SENTINEL } from "./tags";

const cases: Array<{
  description: string;
  input: string;
  text: string;
  codeSpans?: number;
  enumerator?: boolean;
}> = [
  {
    description: "lowercases title-cased words",
    input: "Latency Is the Main Bottleneck",
    text: "latency is the main bottleneck",
  },
  {
    description: "preserves acronyms",
    input: "Internal Cache API",
    text: "internal cache API",
  },
  {
    description: "strips trailing parenthetical",
    input: "Token Exchange (RFC 8693)",
    text: "token exchange",
  },
  {
    description: "strips leading enumerator and reports it",
    input: "Step 1: Read the Transcript",
    text: "read the transcript",
    enumerator: true,
  },
  {
    description: "bare enumerator with colon",
    input: "Phase: Calendar",
    text: "calendar",
    enumerator: true,
  },
  {
    description: "replaces inline code with sentinel",
    input: "The `useCache` Hook",
    text: `the ${CODE_SENTINEL} hook`,
    codeSpans: 1,
  },
  {
    description: "replaces camelCase identifier",
    input: "Migrating getUserById Callers",
    text: `migrating ${CODE_SENTINEL} callers`,
    codeSpans: 1,
  },
  {
    description: "replaces snake_case identifier",
    input: "Renaming session_id Columns",
    text: `renaming ${CODE_SENTINEL} columns`,
    codeSpans: 1,
  },
  {
    description: "replaces path",
    input: "Hooks in plugins/writing/hooks",
    text: `hooks in ${CODE_SENTINEL}`,
    codeSpans: 1,
  },
  {
    description: "replaces ticket ID",
    input: "ABC-1234: Defer the Loader",
    text: `${CODE_SENTINEL}: defer the loader`,
    codeSpans: 1,
  },
  {
    description: "replaces CLI flag",
    input: "The --dry-run Mode",
    text: `the ${CODE_SENTINEL} mode`,
    codeSpans: 1,
  },
  {
    description: "replaces SCREAMING_SNAKE constant",
    input: "Reading CLAUDE_PLUGIN_ROOT at Startup",
    text: `reading ${CODE_SENTINEL} at startup`,
    codeSpans: 1,
  },
  {
    description: "leaves plain lowercase text alone",
    input: "a quiet noun phrase",
    text: "a quiet noun phrase",
  },
];

describe("preprocessHeading", () => {
  for (const { description, input, text, codeSpans, enumerator } of cases) {
    it(description, () => {
      const result = preprocessHeading(input);
      expect(result.text).toBe(text);
      expect(result.codeSpans).toBe(codeSpans ?? 0);
      expect(result.enumerator).toBe(enumerator ?? false);
    });
  }
});
