// Vendored from dmmulroy/anti-slop (MIT, Copyright (c) 2026 Dillon Mulroy).
// https://github.com/dmmulroy/anti-slop
//
// Extended for bun:test, which upstream does not cover. The framework table
// replaces upstream's hardcoded vi/jest checks.

import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/** Module-mocking entry points, keyed by the object they hang off. */
const MOCKERS = new Map<string, { source: string; methods: ReadonlySet<string> }>([
  ["mock", { source: "bun:test", methods: new Set(["module"]) }],
  ["vi", { source: "vitest", methods: new Set(["doMock", "mock", "unstable_mockModule"]) }],
  [
    "jest",
    { source: "@jest/globals", methods: new Set(["doMock", "mock", "unstable_mockModule"]) },
  ],
]);

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

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

/** The mocking framework `expression` refers to, or null when it names something else. */
function mocker(sourceCode: SourceCode, expression: ESTree.Expression): ReadonlySet<string> | null {
  if (expression.type !== "Identifier") return null;
  const entry = MOCKERS.get(expression.name);
  if (entry === undefined) return null;
  if (sourceCode.isGlobalReference(expression)) return entry.methods;

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) return entry.methods;

  const imported = variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    return (
      definition.parent.source.value === entry.source &&
      importedName(definition.node) === expression.name
    );
  });
  return imported ? entry.methods : null;
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

function isModuleMock(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type !== "MemberExpression") return false;
  const methods = mocker(sourceCode, callee.object);
  if (methods === null) return false;
  const name = propertyName(callee);
  return name !== null && methods.has(name);
}

/** Ban module mocking, which swaps a module globally for every later import in the process. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow module mocking; replace dependencies through a real seam.",
    },
    messages: {
      moduleMock:
        "Module mocking patches the module registry for the whole process, so it leaks into later tests in the same file and into modules imported after it. Pass the dependency in as a parameter with a default, or spy on the object you own.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (!isModuleMock(context.sourceCode, node.callee)) return;
        context.report({ node, messageId: "moduleMock" });
      },
    };
  },
});
