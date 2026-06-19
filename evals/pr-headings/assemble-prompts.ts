import { join } from "node:path";

const DIR = import.meta.dirname;
const REPO = join(DIR, "..", "..");

const SKILL = join(REPO, "plugins/pull-request/skills/create/SKILL.md");
const SECTIONS = join(REPO, "plugins/pull-request/skills/create/sections.md");

/**
 * Extracts a `## <name>` section from a markdown body, including its heading
 * line, down to (but not including) the next `## ` heading at the same level.
 */
function extractSection(md: string, name: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (start === -1) throw new Error(`section "## ${name}" not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

const skill = await Bun.file(SKILL).text();
const sections = await Bun.file(SECTIONS).text();
const treatment = (await Bun.file(join(DIR, "treatment-headings.md")).text()).trim();

// The skill's body-writing guidance: the "## Body" section. SKILL.md has no
// separate title/voice section beyond "## Title"; voice guidance lives in
// sections.md's intro. We include "## Body" as the skill-side guidance.
const bodySection = extractSection(skill, "Body");

// BASELINE = "## Body" from SKILL.md + the FULL current sections.md.
const baseline = [
  "# Pull Request Body Guidance",
  "",
  bodySection,
  "",
  "---",
  "",
  sections.trim(),
  "",
].join("\n");

// TREATMENT = identical, except sections.md gets the treatment section
// inserted immediately after "## Shape" (before "## Mine the Conversation"),
// and one bullet appended to the "## Slop to Cut" list.
const SHAPE_MARKER = "## Mine the Conversation";
if (!sections.includes(SHAPE_MARKER)) throw new Error("Shape/Mine boundary not found");

let treatedSections = sections.replace(
  SHAPE_MARKER,
  `${treatment}\n\n${SHAPE_MARKER}`,
);

const SLOP_BULLET =
  "- Sentence or fragment headings. A heading names the topic, it doesn't narrate it.";
// Append to the "## Slop to Cut" list: add the bullet as the last item of
// that list. The list runs to end-of-file, so append at the end.
treatedSections = `${treatedSections.trimEnd()}\n${SLOP_BULLET}\n`;

const treatmentPrompt = [
  "# Pull Request Body Guidance",
  "",
  bodySection,
  "",
  "---",
  "",
  treatedSections.trim(),
  "",
].join("\n");

await Bun.write(join(DIR, "gen-system-baseline.md"), baseline);
await Bun.write(join(DIR, "gen-system-treatment.md"), treatmentPrompt);

console.log("Wrote gen-system-baseline.md and gen-system-treatment.md");
console.log(`baseline: ${baseline.length} chars, treatment: ${treatmentPrompt.length} chars`);
