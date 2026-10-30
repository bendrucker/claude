import { expect, test } from "bun:test";
import limitLines from "./limits";

const long = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const spans = (n: number) => Array.from({ length: n }, (_, i) => `\`c${i}\``).join(" ");

test("passes a short body on every row", () => {
  expect(limitLines(long(10))).toEqual([
    "PR-LIMIT prose-words=pass (10 of 120)",
    "PR-LIMIT max-block=pass (10 of 40)",
    "PR-LIMIT prose-code-spans=pass (0 of 6)",
    "PR-LIMIT path-spans=pass (0 of 1)",
    "PR-LIMIT contrast-phrases=pass (0 of 1)",
    "PR-LIMIT hidden-words=pass (0 of 60)",
    "PR-LIMIT list-words=pass (0 of 150)",
    "PR-LIMIT list-items=pass (0 of 5)",
  ]);
});

test("fails code spans and hidden words without counting collapsed prose as visible", () => {
  const lines = limitLines(`${long(10)} ${spans(7)}\n\n<details>\n\n${long(70)}\n\n</details>`);
  expect(lines.filter((l) => l.includes("=fail"))).toEqual([
    "PR-LIMIT prose-code-spans=fail (7 of 6)",
    "PR-LIMIT hidden-words=fail (70 of 60)",
  ]);
});

test("fails length on a long single paragraph", () => {
  expect(limitLines(long(130)).filter((l) => l.includes("=fail"))).toEqual([
    "PR-LIMIT prose-words=fail (130 of 120)",
    "PR-LIMIT max-block=fail (130 of 40)",
  ]);
});

test("counts list words apart from prose words", () => {
  const list = Array.from({ length: 5 }, () => `- ${long(31)}`).join("\n");
  expect(limitLines(`${long(10)}\n\n${list}`).filter((l) => l.includes("words="))).toEqual([
    "PR-LIMIT prose-words=pass (10 of 120)",
    "PR-LIMIT hidden-words=pass (0 of 60)",
    "PR-LIMIT list-words=fail (155 of 150)",
  ]);
});
