#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/terraform-apply-timeout.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > main.tf <<'TF'
resource "null_resource" "this" {}

resource "time_sleep" "minute" {
  create_duration = "1m"
}
TF
cat > README.md <<'MD'
# terraform-apply-timeout
Demonstrates how Terraform behaves when it is interrupted before completion
MD
git add -A && git commit -qm "init: module with a fast and a slow resource"
