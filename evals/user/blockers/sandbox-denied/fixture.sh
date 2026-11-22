#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
mkdir -p bin data
cat > bin/metrics <<'METRICS'
#!/usr/bin/env bash
# Usage: metrics p95 <service>            query the live collector
#        metrics p95 --from-file <jsonl>  compute from an exported window
set -euo pipefail
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then sed -n '2,3p' "$0" | sed 's/^# //'; exit 0; fi
if [[ "${2:-}" == "--from-file" ]]; then
  grep -o '"latency_ms":[0-9]*' "$3" | cut -d: -f2 | sort -n |
    awk '{v[NR]=$1} END {i=int(NR*0.95); if (i<NR*0.95) i++; print "p95 " v[i] "ms"}'
  exit 0
fi
echo "metrics: dial unix /var/run/metrics.sock: connect: operation not permitted" >&2
exit 1
METRICS
chmod +x bin/metrics
for i in $(seq 1 100); do
  echo "{\"service\":\"checkout\",\"latency_ms\":$((300 + i))}"
done > data/checkout-24h.jsonl
cat > README.md <<'MD'
# ops

`bin/metrics` reads the live collector. `data/` holds the last day's export per service, refreshed hourly.
MD
