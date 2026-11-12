# Raw `glab api`

Use `glab api` only when no `glab mr`, `glab ci`, or plugin script covers the call. `:id`, `:fullpath`, and `:branch` in an endpoint resolve from the current checkout.

## Output

- Only `glab api` lacks `--jq`. Pipe it: `glab api <endpoint> | jq '<filter>'`. Other commands take `--output json --jq`.
- A 4xx response is a JSON error body on stdout (`{"message":"404 Not found"}`). A piped `jq` turns it into `null` or `Cannot index string`. Rerun the call bare and read the body before touching the filter.
- Pair `--paginate` with `--output ndjson` for one item per line across pages. Without it, pages join as `][`, which is invalid JSON.
- `Cannot find valid SSO session` on a write means the browser SAML session lapsed. Ask Ben to sign in to GitLab in the browser instead of retrying.

## Paths and Fields

- A branch or file path in an endpoint goes through `--placeholder`, which encodes a `/` as one segment: `glab api projects/:id/repository/branches/:b --placeholder b=feature/login`.
- `-f key=value` sends the value literally. `-F key=value` coerces numbers and booleans, and reads `key=@file` from a file. A value starting with `@` (such as `@username`) therefore needs `-f`.
- A bracketed field name (`-f 'position[base_sha]=…'`) is an error in a JSON body. Pass a nested object as JSON with `-F`: `-F 'position={"base_sha":"…","new_line":10}'`.
- Long markdown goes in with `-F body=@tmp/note.md`.

## Uploads

`glab mr create`, `glab mr update`, and `glab mr note create` take `--attach <path>`. For other surfaces, such as issues, upload with multipart `--form` and paste the returned markdown. `-F` embeds the bytes in JSON and gets HTTP 400.

```bash
glab api projects/:id/uploads --form "file=@./shot.png" | jq -r .markdown
```

## GraphQL

Put a query with variables in a quoted heredoc. Escaping `$` inline corrupts it (`Expected VAR_SIGN, actual: UNKNOWN_CHAR`).

```bash
glab api graphql -f query="$(cat <<'GQL'
query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) { mergeRequest(iid: $iid) { title } }
}
GQL
)" -f fullPath=group/project -f iid=123
```

Pass variables with `-f`. `-F` coerces `iid` to an int, which fails against `String!`. `projectPath` and `fullPath` are typed `ID!`.

Use only documented mutation names. `mergeRequestSetAutoMerge` and `mergeRequestRequestReview` do not exist: auto-merge goes through `merge.ts`, and re-requesting review is the `/request_review` quick action in [review-state.md](review-state.md). A guessed mutation that does exist runs for real.
