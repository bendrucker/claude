import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

const FORBIDDEN_PROPERTIES = new Set(["columns", "isTTY"]);

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function isGlobalProcess(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier" || expression.name !== "process") return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

function propertyName(node: ESTree.MemberExpression): string | null {
  const { property } = node;
  if (node.computed) {
    return property.type === "Literal" && typeof property.value === "string"
      ? property.value
      : null;
  }
  return property.type === "Identifier" ? property.name : null;
}

function isProcessStdout(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  return (
    expression.type === "MemberExpression" &&
    isGlobalProcess(sourceCode, expression.object) &&
    propertyName(expression) === "stdout"
  );
}

/** Ban sizing CLI output to the terminal, which differs between a TTY and a pipe. */
export const noTerminalWidthRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow process.stdout.columns and process.stdout.isTTY for sizing CLI output.",
    },
    messages: {
      terminalWidth:
        "Do not size CLI output to terminal width. Claude is usually a TTY but sometimes runs piped, where the column count is zero or undefined. Even in a terminal the output lands in context as text, so a fixed width reads the same in both cases. Use a fixed default width with a flag override.",
    },
  },
  createOnce(context) {
    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === null || !FORBIDDEN_PROPERTIES.has(name)) return;
        if (!isProcessStdout(context.sourceCode, node.object)) return;
        context.report({ node, messageId: "terminalWidth" });
      },
    };
  },
});
