# Sourced by each case's fixture: installs the snapshot glab stand-in, then starts a checkout on the
# branch of open MR !41, where `priya-n` requested changes. A second branch,
# `feature/rate-limit`, holds a `config.yaml`.
here=$(dirname "${BASH_SOURCE[0]}")
stubs="$here/../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://gitlab.example.com/team/web.git

mkdir -p src
cat > src/login.ts <<'TS'
export function login(user: string, password: string): boolean {
  return user !== "" && password.length >= 8;
}
TS
BASE=$(commit "2026-10-01T10:00:00Z" "web: login helper")

git switch -qc login-form
cat > src/form.ts <<'TS'
import { login } from "./login";

export function submit(user: string, password: string): string {
  return login(user, password) ? "welcome" : "try again";
}
TS
HEAD_SHA=$(commit_as "Ben Drucker" ben@team.example.com "2026-10-02T10:00:00Z" "web: login form")

git switch -q main
git switch -qc feature/rate-limit
cat > config.yaml <<'YAML'
rate_limit:
  burst: 20
  per_second: 10
YAML
commit_as "Priya Nair" priya@team.example.com "2026-10-03T10:00:00Z" "web: rate limit config" > /dev/null

git update-ref refs/remotes/origin/main "$BASE"
git update-ref refs/remotes/origin/login-form "$HEAD_SHA"
git update-ref refs/remotes/origin/feature/rate-limit feature/rate-limit
git switch -q login-form
mkdir -p tmp
printf '\x89PNG\r\n\x1a\n' > tmp/shot.png

jq -n --arg root "$PWD" --arg base "$BASE" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.eval-stubs/meta.json" <<'JQ'
def user($u): {"bdrucker": {id: 7, username: "bdrucker", name: "Ben Drucker"}, "priya-n": {id: 31, username: "priya-n", name: "Priya Nair"}}[$u];
{
  root: $root,
  host: "gitlab.example.com",
  project: "team/web",
  projectId: 1207,
  viewer: user("bdrucker"),
  mr: {
    iid: 41,
    title: "Add the login form",
    description: "Adds a login form on top of the login helper.",
    author: user("bdrucker"),
    reviewers: [user("priya-n")],
    source_branch: "login-form",
    created_at: "2026-10-02T10:05:00Z",
    updated_at: "2026-10-02T16:00:00Z"
  },
  versions: [{id: 401, head: $head, base: $base, start: $base, created_at: "2026-10-02T10:05:00Z"}],
  discussions: [
    {id: "9c1f4a7e2b8d4e0f9a3c5d6b7e8f0a1b2c3d4e5f", individual_note: false, notes: [
      {id: 7001, type: "DiffNote", body: "The form accepts any 8 character password. Please require a digit too.", author: user("priya-n"), created_at: "2026-10-02T15:00:00Z", updated_at: "2026-10-02T15:00:00Z", system: false, noteable_type: "MergeRequest", noteable_iid: 41, resolvable: true, resolved: false}
    ]}
  ]
}
JQ
