# Reinvented Patterns

Hand-written code that generated implementations commonly reinvent, grouped by kind, with where the maintained version usually lives. The examples name TypeScript, Python, and Go replacements. Find the equivalent for other languages before choosing a package.

## Parsing a Format by Hand

A regex or `split` over a format with a grammar handles the common case and misreads quoting, escapes, nesting, and multi-line values.

- CSV and TSV: `split(",")` per line. Use a CSV parser (`csv` in Python, `encoding/csv` in Go, `csv-parse` or `papaparse` in TypeScript).
- YAML, TOML, INI, `.env`, and frontmatter: slicing between `---` lines or `key=value` splits. Use the format's own loader (`yaml`, `tomllib`, `smol-toml`, `gray-matter`, `dotenv`).
- Markdown: regexes for headings, links, or code fences. Use a Markdown parser and walk the tree.
- Source code: regexes over a language's syntax. Use `ast-grep` or the language's parser.
- URLs and query strings: string concatenation and `split("?")`. Use `URL` and `URLSearchParams`, `urllib.parse`, or `net/url`.
- Command-line arguments: loops over `argv`. Use the project's argument parser, or `node:util` `parseArgs`, `argparse`, or `flag`.
- Versions: splitting on dots to compare. Use a semver library, since prerelease and build metadata ordering is the part a hand-roll gets wrong.
- Durations, dates, and times: unit tables and manual arithmetic. Use `Temporal` or `date-fns`, `datetime`, or `time.ParseDuration`.

## Escaping and Encoding

An escaper that misses one character is a correctness bug at best and an injection at worst.

- Regex escaping: a character-class replace. Use `RegExp.escape`, `re.escape`, or `regexp.QuoteMeta`.
- Shell quoting: wrapping in single quotes and replacing embedded quotes. Use `shlex.quote`, the `shell-quote` package, or pass an argument array and skip the shell.
- HTML, XML, and SQL: string replacement. Use the template engine's escaping, the DOM, or parameterized queries.
- ANSI escape stripping: a hand-written CSI regex. Use the runtime's strip function (`Bun.stripANSI`, `util.stripVTControlCharacters`) or `strip-ansi`.
- Base64, hex, and URL encoding: lookup tables. Use the standard library.

## Concurrency, Retries, and Time

- Bounded parallelism: a hand-written promise pool or worker queue. Use `p-limit`, `asyncio.Semaphore` or `asyncio.TaskGroup`, or `errgroup` with `SetLimit`.
- Retry with backoff: a loop with `sleep`. Use `p-retry`, `tenacity`, or `cenkalti/backoff`, which handle jitter and retryable-error classification.
- Timeouts: racing a `setTimeout` promise. Use `AbortSignal.timeout`, `asyncio.timeout`, or `context.WithTimeout`.
- Sleeping: `new Promise((r) => setTimeout(r, ms))`. Use `Bun.sleep`, `timers/promises` `setTimeout`, `asyncio.sleep`.
- Debounce, throttle, and memoize: closures over timers or maps. Use `functools.cache` and `lru_cache`, or a small maintained package.

## Data Manipulation

- Deep clone via `JSON.parse(JSON.stringify(x))`: use `structuredClone` or `copy.deepcopy`.
- Grouping, chunking, and set operations: reduce loops. Use `Object.groupBy`, `Map.groupBy`, the ES2024 `Set` methods, `itertools.groupby` and `itertools.batched`, or `slices.Chunk`.
- Deep equality and merge: recursive walkers. Use the test framework's matcher in tests and a maintained package elsewhere.
- Validating external JSON with hand-written type guards: use a schema library such as `zod` or `pydantic`.

## Text Formatting

- Tables and aligned columns: `padEnd` loops. Use a table package, or `text/tabwriter`. Hand-rolled padding miscounts wide and combining characters.
- Human-readable numbers, sizes, durations, relative times, and plurals: unit tables and `if` ladders. Use `Intl.NumberFormat`, `Intl.RelativeTimeFormat`, `Intl.DurationFormat`, `Intl.PluralRules`, or `humanize`.
- Word wrapping and truncation: index arithmetic. Use `textwrap`, or a package that measures display width.

## Filesystem and Processes

- Glob matching: converting a glob to a regex. Use `Bun.Glob`, `fs.glob`, `pathlib.Path.glob`, or `path.Match`.
- Temporary directories: building paths under `/tmp`. Use `mkdtemp`, `tempfile`, or `os.MkdirTemp`.
- Atomic writes: write then rename by hand without fsync. Use `write-file-atomic` or the language's atomic helper.
- Locating an executable: walking `$PATH`. Use `Bun.which`, `shutil.which`, or `exec.LookPath`.
- IDs and hashes: random strings from `Math.random`. Use `crypto.randomUUID` and the platform's hash functions.
