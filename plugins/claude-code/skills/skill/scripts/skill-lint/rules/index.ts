import type { Rule } from "../types";
import { bodyRules } from "./body";
import { frontmatterRules } from "./frontmatter";
import { namespaceRules } from "./namespace";
import { tokenRules } from "./tokens";

export const allRules: Rule[] = [
  ...frontmatterRules,
  ...namespaceRules,
  ...bodyRules,
  ...tokenRules,
];

export { findReferences, lintReference } from "./references";
