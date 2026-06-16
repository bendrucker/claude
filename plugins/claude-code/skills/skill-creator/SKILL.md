---
name: claude-code:skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, update or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.
disable-model-invocation: true
---

# Skill Creator

Create new skills and iteratively improve them. The process:

- Decide what the skill should do and roughly how
- Write a draft
- Create a few test prompts and run claude-with-access-to-the-skill on them
- Help the user evaluate the results qualitatively and quantitatively
  - While the runs happen in the background, draft quantitative evals if there aren't any (use or modify existing ones). Then explain them to the user
  - Use `scripts/generate_review.py` to show the user the results and the quantitative metrics
- Rewrite the skill based on the user's evaluation (and any glaring flaws the benchmarks reveal)
- Repeat until satisfied
- Expand the test set and try again at larger scale

Figure out where the user is in this process and help them progress. If they say "I want to make a skill for X", help narrow down what they mean, write a draft, write test cases, evaluate, run the prompts, and repeat. If they already have a draft, go straight to the eval/iterate loop. Stay flexible: if they say "I don't need evaluations, just vibe with me", do that. After the skill is done (order is flexible), run the skill description improver (separate script) to optimize triggering.

## Communicating with the user

Users range widely in familiarity with coding jargon — from plumbers and grandparents newly opening a terminal to fully computer-literate developers. Read context cues to phrase your communication. As a guide:

- "evaluation" and "benchmark" are borderline, but OK
- for "JSON" and "assertion", wait for serious cues that the user knows the terms before using them unexplained

Briefly explain or define terms when in doubt.

---

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user may need to fill the gaps, and should confirm before proceeding.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't need them. Suggest the appropriate default based on the skill type, but let the user decide.

### Interview and Research

Proactively ask about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until this is ironed out.

Check available MCPs — if useful for research (searching docs, finding similar skills, looking up best practices), research in parallel via subagents if available, otherwise inline. Come prepared with context to reduce burden on the user.

### Write the SKILL.md

Based on the interview, fill in these components:

- **name**: Skill identifier
- **description**: When to trigger, what it does. This is the primary triggering mechanism — include both what the skill does AND specific contexts for when to use it. All "when to use" info goes here, not in the body. Claude tends to "undertrigger" skills — to not use them when they'd be useful. To combat this, make descriptions a little "pushy". Instead of "How to build a simple fast dashboard to display internal Anthropic data.", write "How to build a simple fast dashboard to display internal Anthropic data. Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, even if they don't explicitly ask for a 'dashboard.'"
- **compatibility**: Required tools, dependencies (optional, rarely needed)
- the rest of the skill

### Skill Writing Guide

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:
1. **Metadata** (name + description) - Always in context (~100 words)
2. **SKILL.md body** - In context whenever skill triggers (<500 lines ideal)
3. **Bundled resources** - As needed (unlimited, scripts can execute without loading)

These word counts are approximate; go longer if needed.

**Key patterns:**
- Keep SKILL.md under 500 lines; if approaching this limit, add another layer of hierarchy with clear pointers to where the model should go next.
- Reference files clearly from SKILL.md with guidance on when to read them
- For large reference files (>300 lines), include a table of contents

**Domain organization**: When a skill supports multiple domains/frameworks, organize by variant:
```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
Claude reads only the relevant reference file.

#### Principle of Lack of Surprise

Skills must not contain malware, exploit code, or content that could compromise system security. A skill's contents should not surprise the user given its description. Don't create misleading skills or skills designed to facilitate unauthorized access, data exfiltration, or other malicious activities. Things like "roleplay as an XYZ" are OK.

#### Writing Patterns

Prefer imperative form in instructions.

**Defining output formats** — like this:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern** — include examples, formatted like this (deviate a little if "Input" and "Output" appear in the examples themselves):
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### Writing Style

Explain to the model why things matter rather than relying on heavy-handed MUSTs. Use theory of mind; keep the skill general, not narrow to specific examples. Write a draft, then review it with fresh eyes and improve it.

### Test Cases

After drafting, come up with 2-3 realistic test prompts — the kind of thing a real user would say. Share them with the user (you don't have to use this exact language): "Here are a few test cases I'd like to try. Do these look right, or do you want to add more?" Then run them.

Save test cases to `evals/evals.json`. Don't write assertions yet — just the prompts. You'll draft assertions in the next step while the runs are in progress.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

See `references/schemas.md` for the full schema (including the `assertions` field, which you'll add later).

## Running and evaluating test cases

This section is one continuous sequence — don't stop partway through. Do NOT use `/skill-test` or any other testing skill.

Put results in `<skill-name>-workspace/` as a sibling to the skill directory. Within the workspace, organize results by iteration (`iteration-1/`, `iteration-2/`, etc.) and within that, each test case gets a directory (`eval-0/`, `eval-1/`, etc.). Don't create all of this upfront — create directories as you go.

### Step 1: Spawn all runs (with-skill AND baseline) in the same turn

For each test case, spawn two subagents in the same turn — one with the skill, one without. Don't spawn the with-skill runs first and come back for baselines later. Launch everything at once so it finishes around the same time.

**With-skill run:**

```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- Outputs to save: <what the user cares about — e.g., "the .docx file", "the final CSV">
```

**Baseline run** (same prompt, but the baseline depends on context):
- **Creating a new skill**: no skill at all. Same prompt, no skill path, save to `without_skill/outputs/`.
- **Improving an existing skill**: the old version. Before editing, snapshot the skill (`cp -r <skill-path> <workspace>/skill-snapshot/`), then point the baseline subagent at the snapshot. Save to `old_skill/outputs/`.

Write an `eval_metadata.json` for each test case (assertions can be empty for now). Give each eval a descriptive name based on what it's testing — not just "eval-0". Use this name for the directory too. If this iteration uses new or modified eval prompts, create these files for each new eval directory — don't assume they carry over from previous iterations.

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": []
}
```

### Step 2: While runs are in progress, draft assertions

Use this time productively. Draft quantitative assertions for each test case and explain them to the user. If assertions already exist in `evals/evals.json`, review them and explain what they check.

Good assertions are objectively verifiable and have descriptive names — they should read clearly in the benchmark viewer so someone glancing at the results immediately understands what each one checks. Subjective skills (writing style, design quality) are better evaluated qualitatively — don't force assertions onto things that need human judgment.

Update the `eval_metadata.json` files and `evals/evals.json` with the assertions once drafted. Also explain to the user what they'll see in the viewer — the qualitative outputs and the quantitative benchmark.

### Step 3: As runs complete, capture timing data

When each subagent task completes, you receive a notification containing `total_tokens` and `duration_ms`. Save this data immediately to `timing.json` in the run directory:

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

This is the only opportunity to capture this data — it comes through the task notification and isn't persisted elsewhere. Process each notification as it arrives rather than batching them.

### Step 4: Grade, aggregate, and launch the viewer

Once all runs are done:

1. **Grade each run** — spawn a grader subagent (or grade inline) that reads `agents/grader.md` and evaluates each assertion against the outputs. Save results to `grading.json` in each run directory. The grading.json expectations array must use the fields `text`, `passed`, and `evidence` (not `name`/`met`/`details` or other variants) — the viewer depends on these exact field names. For assertions checkable programmatically, write and run a script rather than eyeballing it — scripts are faster, more reliable, and reusable across iterations.

2. **Aggregate into benchmark** — run the aggregation script from the skill-creator directory:
   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```
   This produces `benchmark.json` and `benchmark.md` with pass_rate, time, and tokens for each configuration, with mean ± stddev and the delta. If generating benchmark.json manually, see `references/schemas.md` for the exact schema the viewer expects.
Put each with_skill version before its baseline counterpart.

3. **Do an analyst pass** — read the benchmark data and surface patterns the aggregate stats hide. See `agents/analyzer.md` ("Analyzing Benchmark Results" section) for what to look for: assertions that always pass regardless of skill (non-discriminating), high-variance evals (possibly flaky), and time/token tradeoffs.

4. **Launch the viewer** with both qualitative outputs and quantitative data:
   ```bash
   nohup python <skill-creator-path>/scripts/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "my-skill" \
     --benchmark <workspace>/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```
   For iteration 2+, also pass `--previous-workspace <workspace>/iteration-<N-1>`.

   **Cowork / headless environments:** If `webbrowser.open()` is unavailable or the environment has no display, use `--static <output_path>` to write a standalone HTML file instead of starting a server. Feedback downloads as a `feedback.json` file when the user clicks "Submit All Reviews". After download, copy `feedback.json` into the workspace directory for the next iteration to pick up.

Use generate_review.py to create the viewer; don't write custom HTML.

5. **Tell the user** something like: "I've opened the results in your browser. There are two tabs — 'Outputs' lets you click through each test case and leave feedback, 'Benchmark' shows the quantitative comparison. When you're done, come back here and let me know."

### What the user sees in the viewer

The "Outputs" tab shows one test case at a time:
- **Prompt**: the task that was given
- **Output**: the files the skill produced, rendered inline where possible
- **Previous Output** (iteration 2+): collapsed section showing last iteration's output
- **Formal Grades** (if grading was run): collapsed section showing assertion pass/fail
- **Feedback**: a textbox that auto-saves as they type
- **Previous Feedback** (iteration 2+): their comments from last time, shown below the textbox

The "Benchmark" tab shows the stats summary: pass rates, timing, and token usage for each configuration, with per-eval breakdowns and analyst observations.

Navigation is via prev/next buttons or arrow keys. When done, they click "Submit All Reviews" which saves all feedback to `feedback.json`.

### Step 5: Read the feedback

When the user tells you they're done, read `feedback.json`:

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "the chart is missing axis labels", "timestamp": "..."},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..."},
    {"run_id": "eval-2-with_skill", "feedback": "perfect, love this", "timestamp": "..."}
  ],
  "status": "complete"
}
```

Empty feedback means the user thought it was fine. Focus improvements on test cases where the user had specific complaints.

Kill the viewer server when done:

```bash
kill $VIEWER_PID 2>/dev/null
```

---

## Improving the skill

The heart of the loop: you've run the test cases, the user reviewed the results, now make the skill better based on their feedback.

### How to think about improvements

1. **Generalize from the feedback.** Skills are meant to be used across many different prompts. You and the user iterate on only a few examples because it moves faster — the user knows them well and can assess new outputs quickly. But a skill that works only for those examples is useless. Rather than fiddly overfit changes or constrictive MUSTs, when an issue is stubborn try different metaphors or recommend different working patterns. It's cheap to try and may land on something great.

2. **Keep the prompt lean.** Remove things that aren't pulling their weight. Read the transcripts, not just the final outputs — if the skill is making the model waste time, try removing the parts causing that and see what happens.

3. **Explain the why.** Explain the **why** behind everything you ask the model to do. Today's LLMs are smart; with a good harness they go beyond rote instructions. Even when feedback is terse or frustrated, understand the task and why the user wrote what they wrote, then transmit that understanding into the instructions. Writing ALWAYS or NEVER in all caps, or rigid structures, is a yellow flag — reframe and explain the reasoning so the model understands why it matters.

4. **Look for repeated work across test cases.** Read the transcripts and notice if subagents all independently wrote similar helper scripts or took the same multi-step approach. If all 3 test cases produced a `create_docx.py` or `build_chart.py`, that's a strong signal to bundle that script: write it once, put it in `scripts/`, and tell the skill to use it. Saves every future invocation from reinventing the wheel.

Take your time; thinking time isn't the blocker. Write a draft revision, then review it anew and improve. Get into the user's head to understand what they want and need.

### The iteration loop

After improving the skill:

1. Apply your improvements to the skill
2. Rerun all test cases into a new `iteration-<N+1>/` directory, including baseline runs. If creating a new skill, the baseline is always `without_skill` (no skill) — that stays the same across iterations. If improving an existing skill, use your judgment on the baseline: the original version the user came in with, or the previous iteration.
3. Launch the reviewer with `--previous-workspace` pointing at the previous iteration
4. Wait for the user to review and tell you they're done
5. Read the new feedback, improve again, repeat

Keep going until:
- The user says they're happy
- The feedback is all empty (everything looks good)
- You're not making meaningful progress

---

## Advanced: Blind comparison

For a more rigorous comparison between two versions of a skill (e.g., "is the new version actually better?"), there's a blind comparison system. Read `agents/comparator.md` and `agents/analyzer.md` for details. The idea: give two outputs to an independent agent without telling it which is which, let it judge quality, then analyze why the winner won.

Optional, requires subagents, and most users won't need it. The human review loop is usually sufficient.

---

## Description Optimization

The description field in SKILL.md frontmatter is the primary mechanism determining whether Claude invokes a skill. After creating or improving a skill, offer to optimize the description for better triggering accuracy.

### Step 1: Generate trigger eval queries

Create 20 eval queries — a mix of should-trigger and should-not-trigger. Save as JSON:

```json
[
  {"query": "the user prompt", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

The queries must be realistic — something a Claude Code or Claude.ai user would actually type. Concrete and specific with detail: file paths, personal context about the user's job or situation, column names and values, company names, URLs, a little backstory. Some in lowercase or with abbreviations, typos, or casual speech. Mix lengths, and focus on edge cases rather than clear-cut ones (the user signs off on them).

Bad: `"Format this data"`, `"Extract text from PDF"`, `"Create a chart"`

Good: `"ok so my boss just sent me this xlsx file (its in my downloads, called something like 'Q4 sales final FINAL v2.xlsx') and she wants me to add a column that shows the profit margin as a percentage. The revenue is in column C and costs are in column D i think"`

For the **should-trigger** queries (8-10), think about coverage: different phrasings of the same intent, some formal, some casual. Include cases where the user doesn't explicitly name the skill or file type but clearly needs it. Add uncommon use cases and cases where this skill competes with another but should win.

For the **should-not-trigger** queries (8-10), the most valuable are near-misses — queries that share keywords or concepts but need something different. Adjacent domains, ambiguous phrasing where a naive keyword match would trigger but shouldn't, and cases where the query touches what the skill does but in a context where another tool fits better.

Don't make should-not-trigger queries obviously irrelevant. "Write a fibonacci function" as a negative test for a PDF skill tests nothing. Negatives should be genuinely tricky.

### Step 2: Review with user

Present the eval set to the user for review using the HTML template:

1. Read the template from `assets/eval_review.html`
2. Replace the placeholders:
   - `__EVAL_DATA_PLACEHOLDER__` → the JSON array of eval items (no quotes around it — it's a JS variable assignment)
   - `__SKILL_NAME_PLACEHOLDER__` → the skill's name
   - `__SKILL_DESCRIPTION_PLACEHOLDER__` → the skill's current description
3. Write to a temp file (e.g., `/tmp/eval_review_<skill-name>.html`) and open it: `open /tmp/eval_review_<skill-name>.html`
4. The user can edit queries, toggle should-trigger, add/remove entries, then click "Export Eval Set"
5. The file downloads to `~/Downloads/eval_set.json` — check Downloads for the most recent version if there are multiple (e.g., `eval_set (1).json`)

Bad eval queries lead to bad descriptions.

### Step 3: Run the optimization loop

Tell the user: "This will take some time — I'll run the optimization loop in the background and check on it periodically."

Save the eval set to the workspace, then run in the background:

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```

Use the model ID from your system prompt (the one powering the current session) so the triggering test matches what the user actually experiences.

While it runs, periodically tail the output to give the user updates on which iteration it's on and what the scores look like.

This handles the full optimization loop automatically: splits the eval set into 60% train and 40% held-out test, evaluates the current description (each query 3 times for a reliable trigger rate), then calls Claude with extended thinking to propose improvements based on what failed. It re-evaluates each new description on train and test, iterating up to 5 times. When done, it opens an HTML report showing per-iteration results and returns JSON with `best_description` — selected by test score rather than train score to avoid overfitting.

### How skill triggering works

Understanding the triggering mechanism helps design better eval queries. Skills appear in Claude's `available_skills` list with their name + description, and Claude decides whether to consult a skill based on that description. Claude only consults skills for tasks it can't easily handle on its own — simple one-step queries like "read this PDF" may not trigger a skill even with a perfectly matching description, because Claude handles them directly with basic tools. Complex, multi-step, or specialized queries reliably trigger skills when the description matches.

So eval queries should be substantive enough that Claude would benefit from consulting a skill. Simple queries like "read file X" are poor test cases — they won't trigger skills regardless of description quality.

### Step 4: Apply the result

Take `best_description` from the JSON output and update the skill's SKILL.md frontmatter. Show the user before/after and report the scores.

---

### Package and Present (only if `present_files` tool is available)

If you don't have the `present_files` tool, skip this step. If you do, package the skill and present the .skill file to the user:

```bash
python -m scripts.package_skill <path/to/skill-folder>
```

After packaging, direct the user to the resulting `.skill` file path so they can install it.

---

## Claude.ai-specific instructions

In Claude.ai, the core workflow is the same (draft → test → review → improve → repeat), but Claude.ai has no subagents, so some mechanics change:

**Running test cases**: No subagents means no parallel execution. For each test case, read the skill's SKILL.md, then follow its instructions to accomplish the test prompt yourself, one at a time. Less rigorous than independent subagents (you wrote the skill and you're running it, so you have full context), but a useful sanity check — the human review step compensates. Skip baseline runs; just use the skill to complete the task.

**Reviewing results**: If you can't open a browser (Claude.ai's VM has no display, or you're on a remote server), skip the browser reviewer. Present results in the conversation: for each test case, show the prompt and output. If the output is a file the user needs to see (.docx, .xlsx), save it to the filesystem and tell them where, so they can download and inspect it. Ask for feedback inline: "How does this look? Anything you'd change?"

**Benchmarking**: Skip quantitative benchmarking — it relies on baseline comparisons that aren't meaningful without subagents. Focus on qualitative feedback.

**The iteration loop**: Same as before — improve, rerun, ask for feedback — without the browser reviewer in the middle. You can still organize results into iteration directories on the filesystem.

**Description optimization**: Requires the `claude` CLI (`claude -p`), only available in Claude Code. Skip on Claude.ai.

**Blind comparison**: Requires subagents. Skip it.

**Packaging**: `package_skill.py` works anywhere with Python and a filesystem. On Claude.ai, run it and the user can download the resulting `.skill` file.

---

## Cowork-Specific Instructions

In Cowork:

- You have subagents, so the main workflow (spawn test cases in parallel, run baselines, grade) works. If you hit severe timeout problems, run test prompts in series rather than parallel.
- No browser or display, so generate the eval viewer with `--static <output_path>` to write a standalone HTML file instead of starting a server. Then offer a link the user can click to open it.
- Cowork seems to disincline Claude from generating the eval viewer after running tests, so to reiterate: in Cowork or Claude Code, after running tests, always generate the eval viewer with `generate_review.py` (not your own HTML) so the human can review examples before you revise the skill. GENERATE THE EVAL VIEWER *BEFORE* evaluating inputs yourself — get them in front of the human ASAP.
- Feedback works differently: with no running server, the viewer's "Submit All Reviews" button downloads `feedback.json` as a file. Read it from there (you may have to request access first).
- Packaging works — `package_skill.py` needs only Python and a filesystem.
- Description optimization (`run_loop.py` / `run_eval.py`) works in Cowork since it uses `claude -p` via subprocess, not a browser, but save it until the skill is finished and the user agrees it's in good shape.

---

## Reference files

The agents/ directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent.

- `agents/grader.md` — How to evaluate assertions against outputs
- `agents/comparator.md` — How to do blind A/B comparison between two outputs
- `agents/analyzer.md` — How to analyze why one version beat another

The references/ directory has additional documentation:
- `references/schemas.md` — JSON structures for evals.json, grading.json, etc.

---

The core loop, restated:

- Figure out what the skill is about
- Draft or edit the skill
- Run claude-with-access-to-the-skill on test prompts
- With the user, evaluate the outputs:
  - Create benchmark.json and run `scripts/generate_review.py` to help the user review them
  - Run quantitative evals
- Repeat until you and the user are satisfied
- Package the final skill and return it to the user

Add steps to your TodoList so you don't forget. In Cowork, add "Create evals JSON and run `scripts/generate_review.py` so human can review test cases" to make sure it happens.
