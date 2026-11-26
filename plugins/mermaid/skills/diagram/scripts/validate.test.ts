import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { extractMermaidBlocks, validateFile } from "./validate";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("extractMermaidBlocks", () => {
  test.each<{ name: string; content: string; length: number; contains?: string[]; line?: number }>([
    {
      name: "extracts a single block",
      content: `# Test
\`\`\`mermaid
flowchart LR
    A --> B
\`\`\`
`,
      length: 1,
      contains: ["flowchart LR"],
      line: 3,
    },
    {
      name: "extracts multiple blocks",
      content: `# Test
\`\`\`mermaid
flowchart LR
    A --> B
\`\`\`

\`\`\`mermaid
sequenceDiagram
    A->>B: msg
\`\`\`
`,
      length: 2,
      contains: ["flowchart", "sequenceDiagram"],
    },
    {
      name: "returns empty array when no mermaid blocks",
      content: `# Test
\`\`\`javascript
console.log('hello');
\`\`\`
`,
      length: 0,
    },
    {
      name: "handles unclosed blocks gracefully",
      content: `# Test
\`\`\`mermaid
flowchart LR
    A --> B
`,
      length: 0,
    },
  ])("$name", ({ content, length, contains, line }) => {
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(length);
    for (const [index, substring] of contains?.entries() ?? []) {
      expect(blocks[index]?.content).toContain(substring);
    }
    if (line !== undefined) expect(blocks[0]?.line).toBe(line);
  });
});

describe("validateFile fixtures", () => {
  test.each<{ name: string; file: string; blocks: number; errors: number }>([
    { name: "valid.md", file: "valid.md", blocks: 11, errors: 0 },
    { name: "invalid.md", file: "invalid.md", blocks: 8, errors: 8 },
    { name: "no-mermaid.md", file: "no-mermaid.md", blocks: 0, errors: 0 },
  ])("$name", async ({ file, blocks, errors }) => {
    const result = await validateFile(join(fixturesDir, file));
    expect(result.blocks).toBe(blocks);
    expect(result.errors).toHaveLength(errors);
  });
});
