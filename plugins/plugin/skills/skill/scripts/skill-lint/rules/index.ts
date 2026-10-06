import type { Rule } from "../types";
import { bangExecutionRules } from "./bang-execution";
import { bodyRules } from "./body";
import { frontmatterRules } from "./frontmatter";
import { headerRules } from "./headers";
import { namespaceRules } from "./namespace";
import { tokenRules } from "./tokens";

export const allRules: Rule[] = [
  ...frontmatterRules,
  ...namespaceRules,
  ...bodyRules,
  ...headerRules,
  ...bangExecutionRules,
  ...tokenRules,
];

export { findReferences, lintReference } from "./references";
