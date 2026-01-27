import { parse as parseYaml } from "yaml";
import type { SkillContent } from "./types";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export function parseSkill(raw: string): SkillContent {
  const match = raw.match(FRONTMATTER_REGEX);

  if (!match) {
    return {
      frontmatter: {},
      body: raw,
      raw,
    };
  }

  const [, yamlContent, body] = match;
  let frontmatter: Record<string, unknown> = {};

  try {
    frontmatter = parseYaml(yamlContent ?? "") ?? {};
  } catch {
    frontmatter = {};
  }

  return {
    frontmatter,
    body: body ?? "",
    raw,
  };
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
