#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/terraform-configuration-aliases-action.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > README.md <<'MD'
# terraform-configuration-aliases-action

> GitHub Action for generating aliased provider blocks that satisfy required configuration aliases

Terraform modules can accept multiple instances of a provider using `configuration_aliases`. When used, the `providers` meta-argument will be included to pass in configured provider instances for each alias. However, this means that the module no longer passes `terraform validate` as-is: it is not a complete configuration.

This action inspects a Terraform module, finds all configuration aliases, and writes a `.tf.json` file that defines matching `provider` blocks. This makes the module a complete configuration, allowing `terraform validate` to operate.
MD
cat > action.yml <<'YML'
name: Terraform Configuration Aliases
description: Generate aliased provider blocks that satisfy required configuration aliases
branding:
  color: purple
  icon: code
inputs:
  path:
    description: The path to the Terraform module
    required: false
    default: './'
outputs:
  providers:
    description: The generated provider configuration as a JSON string
    value: ${{ steps.aliases.outputs.providers }}
runs:
  using: composite
  steps:
    - run: |
        echo "::group::go get github.com/hashicorp/terraform-config-inspect"
        go get github.com/hashicorp/terraform-config-inspect
        echo "::endgroup::"
      shell: bash
      env:
        GO111MODULE: 'on'
    - run: echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"
      shell: bash
    - id: aliases
      run: |
        echo "Generating providers for configuration_aliases in Terraform module: ${{ inputs.path }}"
        ${{ github.action_path }}/providers.sh | tee aliased-providers.tf.json
        providers=$(jq -c < aliased-providers.tf.json)
        echo "::set-output name=providers::${providers}"
      shell: bash
      working-directory: ${{ inputs.path }}
YML
git add -A && git commit -qm "action: generate aliased provider blocks"
git switch -qc go-install
cat > action.yml <<'YML'
name: Terraform Configuration Aliases
description: Generate aliased provider blocks that satisfy required configuration aliases
branding:
  color: purple
  icon: code
inputs:
  path:
    description: The path to the Terraform module
    required: false
    default: './'
  terraform-config-inspect-version:
    description: The version of http://github.com/hashicorp/terraform-config-inspect to install
    required: false
    default: 90acf1ca460f724f61d41ab67c8752e74a792e96
outputs:
  providers:
    description: The generated provider configuration as a JSON string
    value: ${{ steps.aliases.outputs.providers }}
runs:
  using: composite
  steps:
    - run: |
        echo "::group::go install github.com/hashicorp/terraform-config-inspect"
        echo "version: $VERSION"
        go install github.com/hashicorp/terraform-config-inspect@$VERSION
        echo "::endgroup::"
      shell: bash
      env:
        VERSION: ${{ inputs.terraform-config-inspect-version }}
    - run: echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"
      shell: bash
    - id: aliases
      run: |
        echo "Generating providers for configuration_aliases in Terraform module: ${{ inputs.path }}"
        ${{ github.action_path }}/providers.sh | tee aliased-providers.tf.json
        providers=$(jq -c < aliased-providers.tf.json)
        echo "::set-output name=providers::${providers}"
      shell: bash
      working-directory: ${{ inputs.path }}
YML
git commit -qam "$(cat <<'MSG'
replace `go get` with `go install`, pin version
MSG
)"
