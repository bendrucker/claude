import { defineRule, type ESTree } from "@oxlint/plugins";

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

/** Matches the literal defaults a swallow returns: `null`, `undefined`, `false`, `""`, `[]`, `{}`. */
function isDefaultValue(expression: ESTree.Expression): boolean {
  const value = unwrapParentheses(expression);
  if (value.type === "Identifier") return value.name === "undefined";
  if (value.type === "ArrayExpression") return value.elements.length === 0;
  if (value.type === "ObjectExpression") return value.properties.length === 0;
  if (value.type !== "Literal" || "regex" in value) return false;
  return value.value === null || value.value === false || value.value === "";
}

function returnsDefault(statement: ESTree.Statement): boolean {
  if (statement.type !== "ReturnStatement") return false;
  return statement.argument === null || isDefaultValue(statement.argument);
}

/** Ban catch blocks that discard the error and return a default without saying why. */
export const noSilentCatchRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow catch blocks whose only statement returns a default, discarding the error unexplained.",
    },
    messages: {
      silent:
        "This catch discards every error and returns a default, so an unexpected failure reads as an ordinary empty result. Narrow the error and rethrow the rest (`if (!(error instanceof X)) throw error;`), or keep the swallow with a comment stating which failure is safe to ignore and why. This is the policy `no-empty` already applies to bare catch blocks.",
    },
  },
  createOnce(context) {
    return {
      CatchClause(node) {
        const [statement] = node.body.body;
        if (node.body.body.length !== 1 || statement === undefined) return;
        if (!returnsDefault(statement)) return;
        if (context.sourceCode.getCommentsInside(node.body).length > 0) return;
        context.report({ node, messageId: "silent" });
      },
    };
  },
});
