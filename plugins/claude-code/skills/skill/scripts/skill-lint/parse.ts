import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { Frontmatter, type SkillContent } from "./types";

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

  return {
    frontmatter: parseFrontmatter(yamlContent ?? ""),
    body: body ?? "",
    raw,
  };
}

function parseFrontmatter(yamlContent: string): z.infer<typeof Frontmatter> {
  try {
    return Frontmatter.parse(parseYaml(yamlContent) ?? {});
  } catch {
    return {};
  }
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
