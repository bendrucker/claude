#!/usr/bin/env sh

set -e

cd "$(dirname "$0")"

for test in *.test.sh; do
  echo "Running $test..."
  ./"$test"
done
