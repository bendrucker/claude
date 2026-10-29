# Sourced by each case's fixture: installs the echoing glab stand-in with the note check, then
# starts a repo on a GitLab origin whose open MR asks why the retry backoff caps at 30 seconds.
here=$(dirname "${BASH_SOURCE[0]}")
stubs="$here/../../../../packages/eval-stubs"
bash "$stubs/install.sh" --check "$here/check.ts"
source "$stubs/preamble.sh" https://gitlab.com/bendrucker/fetcher.git
mkdir -p src
cat > src/retry.ts <<'TS'
export function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}
TS
commit 2026-10-01T12:00:00Z "retry: cap exponential backoff" > /dev/null
