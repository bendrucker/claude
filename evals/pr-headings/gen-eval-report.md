# PR Heading Generation A/B Eval

Model: claude-sonnet-4-6, temperature 0. 18 scenarios x 2 arms.
Combined bad = classifier.flagged OR judge.bad.

## Headline

- Baseline combined bad-rate: 11/17 = 64.7%
- Treatment combined bad-rate: 3/28 = 10.7%
- Delta (treatment - baseline): -54.0 pp
- False-section scenarios (expectSections:false producing any `##`): baseline 0, treatment 0 (delta 0)
- Headings on the 6 small/borderline scenarios: baseline 0, treatment 0

## Per-arm Breakdown

### baseline

- Total headings produced: 17
- Classifier-only bad: 11 (64.7%)
- Judge-only bad: 9 (52.9%)
- Combined-OR bad: 11 (64.7%)
- False-section scenarios: 0 of 6
- Headings on small/borderline: 0

### treatment

- Total headings produced: 28
- Classifier-only bad: 3 (10.7%)
- Judge-only bad: 1 (3.6%)
- Combined-OR bad: 3 (10.7%)
- False-section scenarios: 0 of 6
- Headings on small/borderline: 0

## Per-scenario

| id | category | base headings | base bad | treat headings | treat bad |
| --- | --- | --- | --- | --- | --- |
| 001-claude-638 | multi-section | 2 | 1 | 5 | 0 |
| 002-claude-680 | multi-section | 0 | 0 | 0 | 0 |
| 003-honeycomb-cli-229 | multi-section | 5 | 4 | 5 | 0 |
| 004-honeycomb-cli-234 | multi-section | 1 | 0 | 1 | 0 |
| 005-dotfiles-477 | multi-section | 0 | 0 | 0 | 0 |
| 006-dotfiles-397 | multi-section | 2 | 2 | 3 | 0 |
| 007-worktrunk-3105 | multi-section | 4 | 3 | 5 | 3 |
| 008-bendrucker.me-473 | multi-section | 0 | 0 | 2 | 0 |
| 009-duckdb_webbed-83 | multi-section | 0 | 0 | 1 | 0 |
| 010-tflint-2556 | multi-section | 0 | 0 | 0 | 0 |
| 011-route-agent-34 | multi-section | 0 | 0 | 0 | 0 |
| 012-azure-blob-to-s3-79 | multi-section | 3 | 1 | 6 | 0 |
| 013-claude-688 | small | 0 | 0 | 0 | 0 |
| 014-claude-677 | small | 0 | 0 | 0 | 0 |
| 015-dotfiles-360 | small | 0 | 0 | 0 | 0 |
| 016-claude-573 | small | 0 | 0 | 0 | 0 |
| 017-claude-840 | borderline | 0 | 0 | 0 | 0 |
| 018-dotfiles-492 | borderline | 0 | 0 | 0 | 0 |

## Verbatim Headings (good / BAD by combined-OR)

### 001-claude-638 (multi-section, expectSections=true)

**baseline** (2 headings):

- [BAD ] ## What changed and why  (cls: interrogative opener "what"; sentence case (2 lowercase content words) | judge: Sentence fragment acting as a caption rather than a noun-phrase label; also sentence case -> Changes and Rationale)
- [good] ## Testing

**treatment** (5 headings):

- [good] ## Wordlist Structure
- [good] ## Scan Context
- [good] ## Expanded Patterns
- [good] ## Wordlist File Bypass
- [good] ## Testing

### 002-claude-680 (multi-section, expectSections=true)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 003-honeycomb-cli-229 (multi-section, expectSections=true)

**baseline** (5 headings):

- [BAD ] ## Callback handler scoped to GET /callback  (cls: predicate verb "scoped"; sentence case (2 lowercase content words) | judge: qualifying tail after the head noun — 'scoped to GET /callback' belongs in the body -> Callback Handler)
- [BAD ] ## Corrupt token entry triggers re-authorization  (cls: sentence case (4 lowercase content words) | judge: sentence fragment acting as a caption rather than a noun-phrase label -> Corrupt Token Re-Authorization)
- [BAD ] ## Narrowed 401/403 string matching  (cls: sentence case (2 lowercase content words) | judge: past-tense verb phrase ('Narrowed') makes this a sentence fragment rather than a noun-phrase label -> Auth Error String Matching)
- [BAD ] ## Persisted DCR client ID  (cls: sentence case (1 lowercase content words))
- [good] ## Testing

**treatment** (5 headings):

- [good] ## Callback Handler
- [good] ## Corrupt Token Entry
- [good] ## Auth Rejection Detection
- [good] ## DCR Client ID Persistence
- [good] ## Logout Tests

### 004-honeycomb-cli-234 (multi-section, expectSections=true)

**baseline** (1 headings):

- [good] ## Testing

**treatment** (1 headings):

- [good] ## Testing

### 005-dotfiles-477 (multi-section, expectSections=true)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 006-dotfiles-397 (multi-section, expectSections=true)

**baseline** (2 headings):

- [BAD ] ## What changed and why  (cls: interrogative opener "what"; sentence case (2 lowercase content words) | judge: Sentence fragment acting as a caption rather than a noun phrase naming the topic -> Changes and Motivation)
- [BAD ] ## What I didn't do  (cls: interrogative opener "what"; predicate verb "do"; sentence subject pronoun; sentence case (2 lowercase content words) | judge: Sentence fragment with a subject pronoun leading a clause rather than a noun phrase -> Deferred Work)

**treatment** (3 headings):

- [good] ## Approach
- [good] ## Bootstrap
- [good] ## Limitations

### 007-worktrunk-3105 (multi-section, expectSections=true)

**baseline** (4 headings):

- [BAD ] ## Why dynamic registration matters here  (cls: interrogative opener "why"; sentence case (4 lowercase content words) | judge: sentence fragment with finite verb phrase; asks why rather than naming the topic -> Dynamic Registration)
- [BAD ] ## Per-shell decisions  (cls: sentence case (1 lowercase content words))
- [BAD ] ## The `-V` sed hack removal  (cls: sentence case (3 lowercase content words) | judge: qualifying tail after the code identifier; the dash-V detail belongs in the body -> `-V` Sed Hack)
- [good] ## Testing

**treatment** (5 headings):

- [BAD ] ## Why Dynamic  (cls: interrogative opener "why" | judge: heading is a question fragment — 'Why' belongs in the prose or a parent section named 'Decisions' -> Dynamic Completions)
- [good] ## Zsh Autoload Problem
- [BAD ] ## Bash, Fish, PowerShell  (cls: comma (clause/list))
- [BAD ] ## `sed` Workaround Removed  (cls: predicate verb "removed")
- [good] ## Testing

### 008-bendrucker.me-473 (multi-section, expectSections=true)

**baseline** (0 headings):

- (no headings)

**treatment** (2 headings):

- [good] ## Array Idioms
- [good] ## Module Resolution

### 009-duckdb_webbed-83 (multi-section, expectSections=true)

**baseline** (0 headings):

- (no headings)

**treatment** (1 headings):

- [good] ## Testing

### 010-tflint-2556 (multi-section, expectSections=true)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 011-route-agent-34 (multi-section, expectSections=true)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 012-azure-blob-to-s3-79 (multi-section, expectSections=true)

**baseline** (3 headings):

- [BAD ] ## What changed and why  (cls: interrogative opener "what"; sentence case (2 lowercase content words) | judge: Sentence fragment acting as a clause rather than a noun phrase naming the topic; also sentence case -> Motivation)
- [good] ## Testing
- [good] ## References

**treatment** (6 headings):

- [good] ## Motivation
- [good] ## API Change
- [good] ## SDK Migration
- [good] ## CLI
- [good] ## CI
- [good] ## Testing

### 013-claude-688 (small, expectSections=false)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 014-claude-677 (small, expectSections=false)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 015-dotfiles-360 (small, expectSections=false)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 016-claude-573 (small, expectSections=false)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 017-claude-840 (borderline, expectSections=false)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

### 018-dotfiles-492 (borderline, expectSections=false)

**baseline** (0 headings):

- (no headings)

**treatment** (0 headings):

- (no headings)

## Cost

Generation: 82857 input + 8431 output = $0.3750.
Judge: 7049 input + 1141 output = $0.0383.
Total: 89906 input + 9572 output = $0.4133 (sonnet $3/M in, $15/M out).

