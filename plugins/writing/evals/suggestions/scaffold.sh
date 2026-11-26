# Sourced by each case's fixture as `scaffold.sh <scenario>`: starts an empty repo and leaves
# the scenario's findings in .git, where the fixture hook reads them.
here=$(dirname "${BASH_SOURCE[0]}")
git init -q -b main
printf '/.*\n' >> .git/info/exclude
cp "$here/scenarios/$1/scenario.json" .git/eval-scenario.json
