# `performance:hill-climb` Candidate Eval

A native `claude plugin eval` suite for the candidate step of `performance:hill-climb`: given a settled Frame and a frozen baseline profile, does the session rank the candidates that hold the time above the ones that only look slow? Each case scaffolds a small Go repo with `fixture.sh`, hands it `/performance:hill-climb` with the Frame and profile already done, and grades the Checkpoint's ranked list, with and without the plugin. Nothing builds or runs, so a case costs one read-and-rank session instead of a climb.

## Cases

`logship` replays an incident log into routed JSON records. Its [`repo/`](logship/repo/) holds the program, `frame.md` (the Rules, Harness, and Baseline sections of a climb's notes file), and `profile.txt` (a `pprof -top -cum` listing whose numbers add up). [`truth.json`](logship/truth.json) labels what the fixture plants:

| Item | Label | Gain | Profile entry |
| --- | --- | ---: | --- |
| `dedupe` compares each key against every kept key | win | 43.9% | `main.dedupe` |
| `parseLine` and `normalizeHost` call `regexp.MustCompile` per line | win | 24.2% | `regexp.MustCompile` |
| `Stats.Inc` takes a mutex per event while a reporter goroutine reads | trap | 0.5% | `main.(*Stats).Inc` |
| `fanOut` resolves four regions serially under a `TODO` to go concurrent | trap | ≤3.7% | `main.fanOut` |

The fan-out is a trap because CPU is 0.99 of wall on a 2 vCPU runner: there is no waiting to overlap, and running the CPU-bound regions in parallel saves at most half of their 7.3%. Ranking it low or setting it aside with that reason is right. Ranking it in the top two over-promises. `logship` is the easy control, with two dominant wins.

`ledgerroll` rolls a gzipped payments feed into a CSV ledger. No win dominates, and the largest entry is the trap:

| Item | Label | Gain | Profile entry |
| --- | --- | ---: | --- |
| `decodeRecord` unmarshals into `map[string]any` | win | 11% | `encoding/json.Unmarshal` |
| `aggregate` re-sorts a group after every append | win | 10% | `sort.Slice` |
| `renderRow` formats with `fmt.Sprintf` and `+=` | win | 8% | `fmt.Sprintf` via `renderRow` |
| `groupKey` builds a map key with `fmt.Sprintf` | win | 6% | `fmt.Sprintf` via `groupKey` |
| gzip decompression of the feed | trap | 0% | `compress/gzip.(*Reader).Read` at 31% |

Ranking by raw share puts gzip first, but the feed's compression is fixed and the standard library is the only decompressor in scope. On 1 vCPU, overlapping it with parsing doesn't help. The two `fmt.Sprintf` wins share one 14% entry, so ranking them takes the peek listing's caller split.

## Graders

[`scripts/score.ts`](scripts/score.ts) is the headline score. It finds the reply's candidate list (the numbered list, ranked table, or bullet list that names the most planted items) and reads `truth.json` and `profile.txt`:

- **recall@5**: the gain-weighted share of the planted wins ranked in the first five.
- **traps top 2**: the traps ranked first or second. A trap counts only on an entry that doesn't name a win, so a win that dismisses the mutex in passing does not rank it.
- **cited**: the share of candidates that name a profile entry, by function name or by a percentage from the listing.
- **parallel**: whether any list item weighs parallelism. A paragraph that sets it aside outside the list misses.
- **composite**: recall@5 less 0.5 per trap in the top two.

The case's regex graders are the runner-side proxies `compare.ts` reads. They check the first line of each numbered item, which the case's `append_system_prompt` asks for.

## Running

`bun evals/native/run.ts plugins/performance/evals/candidates -- --runs 4` runs both arms locally with the Bash sandbox disabled. Results land in the gitignored `results/<timestamp>/`.

- `bun plugins/performance/evals/candidates/scripts/score.ts results/<run>...` scores every trace and prints per-run and per-case, per-arm tables, with permutation p-values on the composite and the citation rate between arms. Pass several result directories to pool replicates.
- `bun evals/native/compare.ts <base results> <candidate results>` compares the proxy graders across refs, as in the other suites.
- `bun evals/native/check.ts plugins/performance/evals/candidates` tests the regex graders against the replies in [`examples/`](examples/).
