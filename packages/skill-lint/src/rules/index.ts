import type { Rule } from "../types";
import { bodyRules } from "./body";
import { frontmatterRules } from "./frontmatter";
import { tokenRules } from "./tokens";

export const allRules: Rule[] = [...frontmatterRules, ...bodyRules, ...tokenRules];

export { findReferences, lintReference } from "./references";
