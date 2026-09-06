// Vendored from dmmulroy/anti-slop (MIT, Copyright (c) 2026 Dillon Mulroy).
// https://github.com/dmmulroy/anti-slop
//
// Detection is unmodified. The message names the generic form that lets a
// caller declare the shape at the call site instead of asserting after it.

import { defineRule, type ESTree } from "@oxlint/plugins";

import { lexicalTypeParameterNames } from "./lexical-type-parameters.ts";

type FunctionWithReturnType =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function referencedAliasName(type: ESTree.TSType): string | null {
  if (type.type === "TSParenthesizedType") return referencedAliasName(type.typeAnnotation);
  if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return null;
  return type.typeArguments === null || type.typeArguments.params.length === 0
    ? type.typeName.name
    : null;
}

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow functions whose explicit return contract is unknown or Promise<unknown>.",
    },
    messages: {
      unknownReturn:
        "This function returns `unknown`, so every caller that wants a shape asserts one after the call. Take a type parameter defaulting to `unknown` and let the caller name the shape, or parse the value here and return a domain type.",
    },
  },
  createOnce(context) {
    const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

    const resolvesToUnknown = (
      type: ESTree.TSType,
      shadowedAliases: ReadonlySet<string>,
      visited = new Set<string>(),
    ): boolean => {
      if (type.type === "TSUnknownKeyword") return true;
      if (type.type === "TSParenthesizedType") {
        return resolvesToUnknown(type.typeAnnotation, shadowedAliases, visited);
      }
      if (type.type === "TSUnionType") {
        return type.types.some((member) => resolvesToUnknown(member, shadowedAliases, visited));
      }
      if (
        type.type === "TSTypeReference" &&
        type.typeName.type === "Identifier" &&
        (type.typeName.name === "Promise" || type.typeName.name === "PromiseLike")
      ) {
        const value = type.typeArguments?.params[0];
        return value !== undefined && resolvesToUnknown(value, shadowedAliases, visited);
      }
      const name = referencedAliasName(type);
      if (name === null || visited.has(name) || shadowedAliases.has(name)) return false;
      const alias = aliases.get(name);
      if (alias === undefined || alias.typeParameters !== null) {
        return false;
      }
      const nextVisited = new Set(visited);
      nextVisited.add(name);
      return resolvesToUnknown(alias.typeAnnotation, shadowedAliases, nextVisited);
    };

    const checkReturnType = (node: FunctionWithReturnType) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (
        !resolvesToUnknown(
          annotation.typeAnnotation,
          lexicalTypeParameterNames(node, context.sourceCode.visitorKeys),
        )
      ) {
        return;
      }
      context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
    };

    return {
      Program(node) {
        aliases.clear();
        for (const statement of node.body) {
          const declaration =
            statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (declaration?.type === "TSTypeAliasDeclaration") {
            aliases.set(declaration.id.name, declaration);
          }
        }
      },
      ArrowFunctionExpression: checkReturnType,
      FunctionDeclaration: checkReturnType,
      FunctionExpression: checkReturnType,
      TSCallSignatureDeclaration: checkReturnType,
      TSConstructSignatureDeclaration: checkReturnType,
      TSConstructorType: checkReturnType,
      TSDeclareFunction: checkReturnType,
      TSEmptyBodyFunctionExpression: checkReturnType,
      TSFunctionType: checkReturnType,
      TSMethodSignature: checkReturnType,
    };
  },
});
