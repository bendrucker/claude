import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { extractMermaidBlocks, validateContent, validateFile } from "./validate";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("extractMermaidBlocks", () => {
  it("extracts a single block", () => {
    const content = `# Test
\`\`\`mermaid
flowchart LR
    A --> B
\`\`\`
`;
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.content).toContain("flowchart LR");
    expect(blocks[0]?.line).toBe(3);
  });

  it("extracts multiple blocks", () => {
    const content = `# Test
\`\`\`mermaid
flowchart LR
    A --> B
\`\`\`

\`\`\`mermaid
sequenceDiagram
    A->>B: msg
\`\`\`
`;
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.content).toContain("flowchart");
    expect(blocks[1]?.content).toContain("sequenceDiagram");
  });

  it("returns empty array when no mermaid blocks", () => {
    const content = `# Test
\`\`\`javascript
console.log('hello');
\`\`\`
`;
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(0);
  });

  it("handles unclosed blocks gracefully", () => {
    const content = `# Test
\`\`\`mermaid
flowchart LR
    A --> B
`;
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(0);
  });
});

describe("validateContent", () => {
  it("validates valid flowchart", async () => {
    const content = `\`\`\`mermaid
flowchart LR
    A --> B
\`\`\``;
    const errors = await validateContent(content);
    expect(errors).toHaveLength(0);
  });

  it("reports empty block error", async () => {
    const content = `\`\`\`mermaid
\`\`\``;
    const errors = await validateContent(content);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("Empty");
  });

  it("reports syntax errors", async () => {
    const content = `\`\`\`mermaid
flowchart XY
    A --> B
\`\`\``;
    const errors = await validateContent(content);
    expect(errors).toHaveLength(1);
  });
});

describe("valid fixtures", () => {
  it("validates all blocks in valid.md", async () => {
    const result = await validateFile(join(fixturesDir, "valid.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toBe(11);
  });
});

describe("invalid fixtures", () => {
  it("reports errors for all blocks in invalid.md", async () => {
    const result = await validateFile(join(fixturesDir, "invalid.md"));
    expect(result.errors.length).toBe(result.blocks);
    expect(result.blocks).toBe(8);
  });
});

describe("no mermaid blocks", () => {
  it("reports zero blocks and zero errors", async () => {
    const result = await validateFile(join(fixturesDir, "no-mermaid.md"));
    expect(result.blocks).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
