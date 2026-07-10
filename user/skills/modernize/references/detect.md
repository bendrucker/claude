# Detecting the stack, the floor, and the gap

For each language and each major dependency you need three numbers.

- **Floor.** The oldest version the project promises to support. For an application this is its deploy or runtime target. For a library it is the declared minimum (`engines`, edition, `*_requires`, target framework).
- **Current.** The latest stable version installed or trivially resolvable.
- **Gap.** Everything between floor and current. This is the only range worth researching. Features below the floor are already adoptable, so the only question is whether the project uses them.

When floor and current match, there is still a budget. The project may target a modern version yet predate features in it, written in an older style out of habit.

## Floor sources

Read the manifest. Do not infer the floor from the syntax in the code. That tells you the past, not the promise.

| Ecosystem | Floor lives in | Current / installed |
| :-- | :-- | :-- |
| Node / JS | `package.json` `engines.node`; `.nvmrc`; CI matrix | `node --version`, `package.json` deps |
| Bun | `package.json` `engines.bun`; CI; presence of `bun.lock`, `@types/bun` | `bun --version` |
| Deno | `deno.json` imports/`compilerOptions`; CI | `deno --version` |
| TypeScript | `tsconfig.json` `compilerOptions.target` / `lib` | `tsc --version` |
| Python | `pyproject.toml` `requires-python`; `setup.cfg`/`setup.py` `python_requires`; `.python-version`; classifiers | `python --version`, lockfile |
| Go | `go.mod` `go` directive | `go version` |
| Rust | `Cargo.toml` `rust-version` (MSRV) and `edition` | `rustc --version` |
| Java | `pom.xml` `maven.compiler.release`; Gradle `sourceCompatibility`/`toolchain` | `java -version` |
| Kotlin | Gradle `jvmTarget`, `languageVersion` | compiler plugin version |
| C# / .NET | `<TargetFramework>` / `<LangVersion>` in `.csproj` | `dotnet --version` |
| Ruby | `.ruby-version`; gemspec `required_ruby_version`; `Gemfile` `ruby` | `ruby --version` |
| PHP | `composer.json` `require.php` | `php --version` |
| Swift | `Package.swift` `swift-tools-version`, platform mins | `swift --version` |
| C / C++ | build flags `-std=`, CMake `CXX_STANDARD` | compiler version |

## Tested floor

The build manifest can lie. The CI matrix is the floor the project actually tests against, and the one consumers feel. If `engines.node` says `>=16` but CI runs only 20 and 22, the tested floor is 20, while a published library still promises 16. For libraries, trust the declared minimum and flag untested-but-promised versions as a risk. For apps, trust CI and the deploy target.

## Runtime detection

A `package.json` does not mean Node. A project may run on Bun or Deno, which set their own feature floors and ship their own stdlib. Check for `bun.lock`, `@types/bun`, `"types": ["bun"]`, or a `deno.json` before running `node --version` or reasoning about Node-version features. Two consequences follow.

The language floor is the runtime's floor, not Node's. A Bun project's adoptable features track Bun, not whatever version a `.nvmrc` happens to name.

These runtimes implement the `node:` builtins (`node:fs`, `child_process`, streams). Code using them is not stale. Replacing it with a runtime-native form like `Bun.file` or `Bun.$` is a lateral rewrite that must clear earn-its-keep on its own, not a version-gap modernization.

## No declared floor

A `private` application with no `engines` and a target or edition set to the newest version has its local toolchain as the floor. There is no support promise to break.

Every language feature up to the target is adopt-now, never a bump. The budget is pure idiom adoption: the code may be written in an older style than its own target permits, out of habit or age. If a worthwhile feature needs a newer toolchain than the target, raising the target is cheap, unlike a published library where the floor is a contract.

## Major dependencies

The dependency axis is reserved for frameworks and load-bearing libraries, the ones whose APIs shape the code. Find them in the same manifests (usually `dependencies`, not `devDependencies`). Ignore transitive and incidental dependencies. A test: would adopting the new API touch many files and change how a core concern is expressed? If yes, it is major.

For each major dependency, record its floor (the manifest range, e.g. `^4.0`) and the current stable release. Research the gap the same way as the language gap.

## Polyglot repos

Detect per language and keep the axes separate. A focus argument (`$ARGUMENTS`) may name one language or directory. Honor it and skip the rest. With no argument, survey each language but rank candidates globally so the report leads with the highest-leverage work regardless of language.
