const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Module specifiers imported by a TypeScript source, relative and bare alike.
 *
 * `Transpiler.scanImports` elides type-only imports, so the `type` keyword is
 * stripped first: a type-only import of a package the workspace never declared
 * still fails to resolve under `oxlint --type-aware`, and one that reaches
 * outside a plugin still couples the two plugins. Only the two forms carrying a
 * module specifier are rewritten, because a bare `export type Name =` declares
 * a local alias and must survive intact for the source to still parse.
 */
export function scanImports(source: string): string[] {
  const body = source.startsWith("#!") ? source.slice(source.indexOf("\n") + 1) : source;
  const values = body
    .replaceAll(/\bimport\s+type\s+/g, "import ")
    .replaceAll(/\bexport\s+type\s+(?=[{*])/g, "export ");

  return transpiler.scanImports(values).map(({ path }) => path);
}

export function isBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:");
}

/** The installable package a specifier belongs to, dropping any subpath. */
export function packageName(specifier: string): string {
  const segments = specifier.startsWith("@") ? 2 : 1;
  return specifier.split("/").slice(0, segments).join("/");
}
