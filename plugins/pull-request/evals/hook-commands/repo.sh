# Sourced by each case's fixture as `repo.sh <origin> [<dir>]`: installs the echoing gh and glab
# stand-ins, then starts a repo on a feature branch whose change quotes CSV fields under <dir>.
here=$(dirname "${BASH_SOURCE[0]}")
bash "$here/../../../../packages/eval-stubs/install.sh" --check "$here/../pr-body/limits.ts"
# The sandbox blocks writes to .git/config, which `git push -u` needs, so the git dir is .repo.
git init -q -b main --separate-git-dir=.repo
# The Linux sandbox mounts placeholder dotfiles into the working tree.
printf '/.*\n/tmp/\n' >> .repo/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin "$1"
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .repo/origin.git
git remote set-url --push origin "$PWD/.repo/origin.git"
src="${2:-.}/src"
mkdir -p "$src"
cat > "$src/export.ts" <<'TS'
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(",")).join("\n");
}
TS
git add -A && git commit -qm "export: add csv export"
git switch -qc quote-fields
cat > "$src/export.ts" <<'TS'
function quote(field: string): string {
  return /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(quote).join(",")).join("\n");
}
TS
git commit -qam "export: quote fields holding commas, quotes, or newlines"
