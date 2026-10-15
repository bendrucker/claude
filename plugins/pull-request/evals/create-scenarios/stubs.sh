#!/usr/bin/env bash
# Installs glab and gh stand-ins whose create command prints the title and body it was given.
# The session's Bash tool sources only $HOME/.zshenv, so that file puts the stand-ins first.
set -euo pipefail
stub="$HOME/.local/stub"
mkdir -p "$stub"
cat > "$stub/glab" <<'STUB'
#!/usr/bin/env bash
tool=$(basename "$0")
args="$*"
case "$tool:${1:-} ${2:-}" in
  glab:"mr create" | gh:"pr create") ;;
  *)
    echo "$tool stand-in: $args is unavailable offline" >&2
    exit 1
    ;;
esac
shift 2

title=""
body=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -t | --title) title="${2-}"; shift 2 ;;
    --title=*) title="${1#--title=}"; shift ;;
    -d | --description | -b | --body)
      body="${2-}"
      shift 2
      if [[ "$body" == "-" ]]; then body=$(cat); fi
      ;;
    --description=* | --body=*) body="${1#*=}"; shift ;;
    -F | --body-file | --body-file=* | --description-file | --description-file=*)
      if [[ "$1" == *=* ]]; then
        file="${1#*=}"
        shift
      else
        file="${2-}"
        shift 2
      fi
      if [[ "$file" == "-" ]]; then body=$(cat); else body=$(cat "$file"); fi
      ;;
    *) shift ;;
  esac
done

remote=$(git remote get-url origin 2> /dev/null || true)
path=$(printf '%s' "$remote" | sed -E 's#^[a-z+]+://[^/]+/##; s#^[^@/]+@[^:]+:##; s#\.git$##')
if [[ "$tool" == "glab" ]]; then
  url="https://gitlab.com/$path/-/merge_requests/1"
else
  url="https://github.com/$path/pull/1"
fi

printf 'PR-TITLE: %s\n' "$title"
printf 'PR-BODY-BEGIN\n'
printf '%s\n' "$body"
printf 'PR-BODY-END\n'
printf '%s\n' "$url"
STUB
chmod +x "$stub/glab"
cp "$stub/glab" "$stub/gh"
chmod +x "$stub/gh"
echo "export PATH=\"$stub:\$PATH\"" >> "$HOME/.zshenv"
