# Memory Staleness Checks

You are checking Claude Code auto-memory files for staleness. Each file records one fact that was true when written. Your job is to establish whether each fact is still true today, using evidence you can cite, and return one verdict per file. Leave every memory and repo file unchanged.

## Inputs

After this brief you receive the memory directory, today's date, your file paths, each file's row from the session index activity query (`writes`, `last_write`, `reads`, `last_read`, `recalls`, `last_recall`), and two session index commands: one for ad-hoc read-only SQL and one for the `search` query. A file with no row has no indexed activity.

## Per File

Read the file in full. Take the written-on date from `metadata.modified`, else `last_write`, else the start of the `metadata.originSessionId` session (through the ad-hoc SQL command, `SELECT min(timestamp) FROM messages WHERE session_id = '<id>'`), else the file's mtime (`stat -f %Sm -t %F <path>`). Extract every checkable claim, then run the checks that apply.

### Repo

Find the repo the memory is about: a path it cites, a repo it names, or the project the memory directory encodes (`-Users-<user>-src-<org>-<repo>` is `~/src/<org>/<repo>`). Check against the repo's default branch, not a worktree. Run `git -C <repo> fetch -q origin`, then read through `origin/HEAD`. When the fetch fails, keep reading through `origin/HEAD` as last fetched and give its commit date in the evidence (`git -C <repo> log -1 --format=%cs origin/HEAD`).

### Paths

Check each cited file or directory with `git -C <repo> cat-file -e origin/HEAD:<path>`. For a path that is missing, find a rename with `git -C <repo> log origin/HEAD --diff-filter=R --name-status --format= -- '*<basename>'` and report the new path.

### Identifiers

Check each cited flag, setting key, script name, query name, function, or skill name with `git -C <repo> grep -n <identifier> origin/HEAD`. For a binary or shell command, use `command -v`.

### PRs and Issues

Check each `#123`, PR, or issue reference with `gh pr view <n> -R <owner>/<repo> --json state,mergedAt,title` (or `gh issue view`). A memory that calls merged work open, or waits on something since closed, is stale.

### Later Work

Run `git -C <repo> log origin/HEAD --since=<written-on> --oneline -- <cited paths>` for each cited path. Read the commits that touch the memory's subject and judge whether they change the fact.

Then search the session index for later sessions on the same subject with the `search` command you were given. Set `query` to the memory's distinctive terms (identifiers, tool names, the subject noun) in one string, and `after_date` to the written-on date.

Read the matching text of the top five hits. A hit is on-subject when its text discusses an identifier or decision the memory names. Ignore the rest. A later session that reversed the decision, finished the open item, or contradicted the stated preference is evidence of supersession.

### Repo Records It

Grep the repo's `CLAUDE.md`, `.claude/rules/`, `user/rules/`, and skill bodies for the memory's rule. When the repo now states it, the memory duplicates it.

### Links and Format

Check that each `[[name]]` link resolves: some file in the memory directory has that `name` or that filename stem. An unresolved link is a Fix. A `name` that differs from its filename stem is fine when no link breaks. Check the frontmatter has `name`, a complete one-line `description`, and `metadata.type` set to `user`, `feedback`, `project`, or `reference`. A truncated description is a Fix.

### Duplicates

Compare against the other memory files in the directory when a fact looks familiar. When another file states the same fact, retire the less complete one.

## Verdicts

- `current`: every claim checked holds.
- `fix`: the fact still applies but a detail is wrong. Give the exact old text and new text.
- `retire`: the fact became false, its work finished with nothing left to apply, the repo records it, or another memory duplicates it.
- `unverifiable`: the evidence is unavailable. State what is missing.

Base each verdict on evidence you ran. List a claim you could not check as `unchecked` in its evidence line. It never counts as holding. A memory of Ben's preference stays `current` unless a later session contradicts it.

## Output

Return only one block per file, in this format:

```
### <filename>
verdict: current | fix | retire | unverifiable
evidence:
- <claim> → <command or query> → <result>
proposal: <exact edit as old → new, deletion plus replacement memory, or none>
```

You are done when every file you were given has a block and every claim you extracted appears in an evidence line.
