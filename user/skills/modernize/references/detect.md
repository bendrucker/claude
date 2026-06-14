# Detecting the stack, the floor, and the gap

For each language and each major dependency you need three numbers:

- **Floor** — the oldest version the project promises to support. For an application this is its deploy/runtime target. For a library it is the declared minimum (`engines`, edition, `*_requires`, target framework).
- **Current** — the latest stable version actually installed or trivially resolvable.
- **Gap** — everything between floor and current. This is the only range worth researching. Features below the floor are already adoptable; the question is only whether the project *uses* them.

When floor and current are the same, there is still a modernization budget: the project may target a modern version but predate features in it, written in an older style out of habit.

## Where the floor is declared

Read the manifest. Do not infer the floor from the syntax already in the code — that tells you the past, not the promise.

| Ecosystem | Floor lives in | Current / installed |
| :-- | :-- | :-- |
| Node / JS | `package.json` `engines.node`; `.nvmrc`; CI matrix | `node --version`, `package.json` deps |
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

## CI as the real floor

The build manifest can lie. The CI matrix is the floor the project actually tests against, and it is the one consumers feel. If `engines.node` says `>=16` but CI only runs 20 and 22, the *tested* floor is 20 — but a published library still promises 16. For libraries, trust the declared minimum and treat untested-but-promised versions as a risk to flag. For apps, trust CI and the deploy target.

## Major dependencies, not all of them

Modernization on the dependency axis is reserved for frameworks and load-bearing libraries — the ones whose APIs shape the code. Find them in the same manifests (`dependencies`, not `devDependencies`, usually). Ignore transitive and incidental dependencies. A good test: would adopting the new API touch many files and change how a core concern is expressed? If yes, it is major.

For each major dependency, record its floor (the range in the manifest, e.g. `^4.0`) and the current stable release. The gap there is researched the same way as the language gap.

## Polyglot repos

Detect per language and keep the axes separate. A focus argument (`$ARGUMENTS`) may name one language or directory — honor it and skip the rest. With no argument, survey each language but rank candidates globally so the report leads with the highest-leverage work regardless of language.
