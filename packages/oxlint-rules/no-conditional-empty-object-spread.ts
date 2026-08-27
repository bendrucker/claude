// Vendored from dmmulroy/anti-slop (MIT, Copyright (c) 2026 Dillon Mulroy).
// https://github.com/dmmulroy/anti-slop
//
// Detection is unmodified. The message names the form that typechecks under
// this repo's `exactOptionalPropertyTypes`.

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

function isConditionalEmptyObjectSpread(node: ESTree.Expression): boolean {
  const conditional = unwrapParentheses(node);
  return (
    conditional.type === "ConditionalExpression" &&
    (isEmptyObjectExpression(conditional.consequent) ||
      isEmptyObjectExpression(conditional.alternate))
  );
}

/** Ban spreading an empty object to omit a property, which buries the omission in a ternary. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow object spreads that conditionally spread an empty object to omit fields.",
    },
    messages: {
      avoid:
        "This conditional spread hides property omission inside a ternary. Declare the object, then add the property under an `if`. Assigning the property as possibly-undefined instead does not typecheck under `exactOptionalPropertyTypes`.",
    },
  },
  createOnce(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;
        if (!isConditionalEmptyObjectSpread(node.argument)) return;
        context.report({ node, messageId: "avoid" });
      },
    };
  },
});
