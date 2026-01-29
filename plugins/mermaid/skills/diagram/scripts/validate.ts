#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { cli } from "cleye";
import { JSDOM } from "jsdom";

export interface MermaidBlock {
  content: string;
  line: number;
}

export interface ValidationError {
  line: number;
  message: string;
}

export interface ValidationResult {
  file: string;
  blocks: number;
  errors: ValidationError[];
}

let mermaidInitialized = false;

async function initMermaid() {
  if (mermaidInitialized) return;

  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    pretendToBeVisual: true,
  });

  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;

  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false });
  mermaidInitialized = true;
}

async function parseMermaid(code: string): Promise<void> {
  await initMermaid();
  const mermaid = (await import("mermaid")).default;
  await mermaid.parse(code);
}

export function extractMermaidBlocks(content: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lines = content.split("\n");
  let inBlock = false;
  let blockStart = 0;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!inBlock && line.trim().startsWith("```mermaid")) {
      inBlock = true;
      blockStart = i + 1;
      blockLines = [];
    } else if (inBlock && line.trim() === "```") {
      blocks.push({
        content: blockLines.join("\n"),
        line: blockStart + 1,
      });
      inBlock = false;
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

async function validateBlock(block: MermaidBlock): Promise<ValidationError | null> {
  const trimmed = block.content.trim();
  if (!trimmed) {
    return { line: block.line, message: "Empty mermaid block" };
  }

  try {
    await parseMermaid(block.content);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { line: block.line, message: message.replace(/\n/g, " ").trim() };
  }
}

export async function validateBlocks(blocks: MermaidBlock[]): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  for (const block of blocks) {
    const error = await validateBlock(block);
    if (error) {
      errors.push(error);
    }
  }
  return errors;
}

export async function validateContent(content: string): Promise<ValidationError[]> {
  return validateBlocks(extractMermaidBlocks(content));
}

export async function validateFile(file: string): Promise<ValidationResult> {
  const content = await readFile(file, "utf-8");
  const blocks = extractMermaidBlocks(content);
  const errors = await validateBlocks(blocks);
  return { file, blocks: blocks.length, errors };
}

async function main() {
  const argv = cli({
    name: "validate",
    parameters: ["<files...>"],
    flags: {
      json: {
        type: Boolean,
        description: "Output as JSON",
        default: false,
      },
    },
    help: {
      description: "Validate Mermaid diagrams in markdown files",
    },
  });

  const files = argv._.files;
  const results: ValidationResult[] = [];
  let hasErrors = false;

  for (const file of files) {
    const result = await validateFile(file);
    results.push(result);
    if (result.errors.length > 0) {
      hasErrors = true;
    }
  }

  if (argv.flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      if (result.blocks === 0) {
        console.log(`${result.file}: No mermaid blocks found`);
      } else if (result.errors.length === 0) {
        console.log(`✓ ${result.file}: ${result.blocks} block(s) valid`);
      } else {
        console.log(
          `✗ ${result.file}: ${result.errors.length} error(s) in ${result.blocks} block(s)`,
        );
        for (const error of result.errors) {
          console.log(`  Line ${error.line}: ${error.message}`);
        }
      }
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
