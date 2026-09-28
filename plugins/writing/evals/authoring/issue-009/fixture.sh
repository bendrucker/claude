#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/TakeScoop/terraform-cloud-outputs-action.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > README.md <<'MD'
# terraform-cloud-remote-state-action

GitHub Action to fetch outputs from a Terraform Cloud workspace
MD
cat > go.mod <<'MOD'
module github.com/takescoop/terraform-cloud-remote-state-action

go 1.17
MOD
cat > main.go <<'GO'
package main

func main() {}
GO
git add -A && git commit -qm "init: fetch Terraform Cloud workspace outputs"
