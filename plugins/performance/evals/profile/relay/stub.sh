#!/bin/bash
# samply for a sandboxed eval session: `record` runs through the relay daemon outside the sandbox.
queue="@QUEUE@"
case "${1-}" in
  --version | -V)
    cat "@VERSION@"
    exit 0
    ;;
  record) ;;
  *)
    echo "samply: only \`samply record\` and \`samply --version\` are available here" >&2
    exit 2
    ;;
esac
id="$$-$RANDOM"
printf '%s\0' "$PWD" "$@" > "$queue/$id.tmp"
env -0 > "$queue/$id.env"
mv "$queue/$id.tmp" "$queue/$id.req"
for _ in $(seq 1 6000); do
  if [[ -s "$queue/$id.code" ]]; then
    cat "$queue/$id.out"
    cat "$queue/$id.err" >&2
    code=$(cat "$queue/$id.code")
    rm -f "$queue/$id".*
    exit "$code"
  fi
  sleep 0.1
done
echo "samply: the relay did not answer within 10 minutes" >&2
exit 1
