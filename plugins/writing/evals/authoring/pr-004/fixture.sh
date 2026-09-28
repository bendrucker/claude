#!/usr/bin/env bash
set -euo pipefail
git init -q -b master
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
echo "!/.github" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/TakeScoop/terraform-check-modules-workflow.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
mkdir -p .github/workflows test/valid
cat > .github/workflows/check.yml <<'YAML'
name: Check Terraform Modules
on:
  workflow_call:
    inputs:
      working_directory:
        description: The working directory where Terraform modules will be recursively found and checked.
        type: string
        required: false
        default: ./
      terraform_version:
        description: The version of Terraform that will be used.
        type: string
        required: false
        default: latest
      terraform_hostname:
        description: The Terraform Cloud hostname.
        type: string
        required: false
        default: terraform.takescoop.com
      tflint_version:
        description: The version of TFLint that will be used.
        type: string
        required: false
        default: latest
      tflint_config_version:
        description: The version of TFLint config from https://github.com/takescoop/tflint-config that will be used.
        type: string
        required: false
        default: v1
    secrets:
      terraform_token:
        description: The Terraform Cloud token that will be used to download private modules and providers. Should have read-only access.
        required: false
jobs:
  find-modules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - id: get-module-directories
        uses: bendrucker/find-terraform-modules@v1
        with:
          working-directory: ${{ inputs.working_directory }}
    outputs:
      matrix: ${{ steps.get-module-directories.outputs.modules }}
  fmt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ inputs.terraform_version }}
      - run: terraform fmt -check -diff -recursive
        working-directory: ${{ inputs.working_directory }}
  validate:
    runs-on: ubuntu-latest
    needs: find-modules
    strategy:
      matrix:
        module: ${{ fromJson(needs.find-modules.outputs.matrix) }}
    defaults:
      run:
        working-directory: ${{ matrix.module }}
    steps:
      - uses: actions/checkout@v3
      - uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ inputs.terraform_version }}
          cli_config_credentials_hostname: ${{ inputs.terraform_hostname }}
          cli_config_credentials_token: ${{ secrets.terraform_token }}
      - run: terraform init -backend=false
      - run: terraform validate
  lint:
    runs-on: ubuntu-latest
    needs: find-modules
    strategy:
      matrix:
        module: ${{ fromJson(needs.find-modules.outputs.matrix) }}
    defaults:
      run:
        working-directory: ${{ matrix.module }}
    steps:
      - uses: actions/checkout@v3
      - uses: terraform-linters/tflint-load-config-action@v0
        with:
          source-repo: TakeScoop/tflint-config
          source-ref: v1
          token: ${{ secrets.GITHUB_TOKEN }}
      - uses: terraform-linters/setup-tflint@v1
        name: Setup TFLint
        with:
          tflint_version: ${{ inputs.tflint_version }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
      - run: tflint --format compact
YAML
cat > .github/workflows/test.yml <<'YAML'
name: Test
on:
  push:
    branches:
      - master
  pull_request:
    branches:
      - master
jobs:
  test:
    uses: ./.github/workflows/check.yml
    with:
      working_directory: ./test/valid
YAML
git add -A && git commit -qm "Initial state"
git switch -qc config-aliases
cat > .github/workflows/check.yml <<'YAML'
name: Check Terraform Modules
on:
  workflow_call:
    inputs:
      working_directory:
        description: The working directory where Terraform modules will be recursively found and checked.
        type: string
        required: false
        default: ./
      terraform_version:
        description: The version of Terraform that will be used.
        type: string
        required: false
        default: latest
      terraform_hostname:
        description: The Terraform Cloud hostname.
        type: string
        required: false
        default: terraform.takescoop.com
      tflint_version:
        description: The version of TFLint that will be used.
        type: string
        required: false
        default: latest
      tflint_config_version:
        description: The version of TFLint config from https://github.com/takescoop/tflint-config that will be used.
        type: string
        required: false
        default: v1
    secrets:
      terraform_token:
        description: The Terraform Cloud token that will be used to download private modules and providers. Should have read-only access.
        required: false
jobs:
  find-modules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - id: get-module-directories
        uses: bendrucker/find-terraform-modules@v1
        with:
          working-directory: ${{ inputs.working_directory }}
    outputs:
      matrix: ${{ steps.get-module-directories.outputs.modules }}
  fmt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ inputs.terraform_version }}
      - run: terraform fmt -check -diff -recursive
        working-directory: ${{ inputs.working_directory }}
  validate:
    runs-on: ubuntu-latest
    needs: find-modules
    strategy:
      matrix:
        module: ${{ fromJson(needs.find-modules.outputs.matrix) }}
    defaults:
      run:
        working-directory: ${{ matrix.module }}
    steps:
      - uses: actions/checkout@v3
      - uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ inputs.terraform_version }}
          cli_config_credentials_hostname: ${{ inputs.terraform_hostname }}
          cli_config_credentials_token: ${{ secrets.terraform_token }}
      - run: terraform init -backend=false
      - uses: bendrucker/terraform-configuration-aliases-action@v1
        with:
          path: ${{ matrix.module }}
      - run: terraform validate
  lint:
    runs-on: ubuntu-latest
    needs: find-modules
    strategy:
      matrix:
        module: ${{ fromJson(needs.find-modules.outputs.matrix) }}
    defaults:
      run:
        working-directory: ${{ matrix.module }}
    steps:
      - uses: actions/checkout@v3
      - uses: terraform-linters/tflint-load-config-action@v0
        with:
          source-repo: TakeScoop/tflint-config
          source-ref: v1
          token: ${{ secrets.GITHUB_TOKEN }}
      - uses: terraform-linters/setup-tflint@v1
        name: Setup TFLint
        with:
          tflint_version: ${{ inputs.tflint_version }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
      - run: tflint --format compact
YAML
cat > .github/workflows/test.yml <<'YAML'
name: Test
on:
  push:
    branches:
      - master
  pull_request:
    branches:
      - master
jobs:
  valid:
    uses: ./.github/workflows/check.yml
    with:
      working_directory: ./test/valid
  configuration-alias:
    uses: ./.github/workflows/check.yml
    with:
      working_directory: ./test/configuration-alias
YAML
mkdir -p test/configuration-alias
cat > test/configuration-alias/main.tf <<'TF'
resource "null_resource" "foo" {
  provider = null.foo
}
TF
touch test/configuration-alias/outputs.tf test/configuration-alias/variables.tf
cat > test/configuration-alias/versions.tf <<'TF'
terraform {
  required_version = ">= 1, < 2"

  required_providers {
    null = {
      source  = "hashicorp/null"
      version = ">= 1"

      configuration_aliases = [null.foo]
    }
  }
}
TF
git add -A && git commit -qm "Automatically populate configuration aliases before \`terraform validate\`"
