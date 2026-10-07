#!/usr/bin/env bash
set -euo pipefail
git init -q -b master
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
echo "!/.github" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/TakeScoop/terraform-cloud-workspace-action.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > README.md <<'MD'
# Terraform Cloud Workspace Action

A GitHub action for managing Terraform Cloud workspaces

## Usage

```yaml
name: TFLint
on: [push]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: takescoop/terraform-cloud-workspace-action@v0
        with:
          terraform_token: "${{ secrets.TF_TOKEN }}"
          terraform_organization: "my-org"
          apply: "${{ github.ref == format('refs/heads/{0}', github.event.repository.default_branch) }}"
          backend_config: |-
            s3:
              bucket: my-bucket
              key: foo.tfstate
              region: us-east-1
```

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `allow_workspace_deletion` | Whether to allow workspaces to be deleted. If enabled, workspace state may be irrecoverably deleted | `false` |
| `apply` | (required) Whether to apply the proposed Terraform changes | |
| `terraform_organization` | (required) Terraform Cloud organization | |
| `terraform_token`  | (required) Terraform Cloud token | |
| `agent_pool_id` | ID of an agent pool to assign to the workspace. If passed, execution_mode is set to "agent" | |
| `auto_apply` | Whether to set auto_apply on the workspace or workspaces | true |
| `backend_config` | YAML encoded backend configurations | |
| `description` | Terraform Cloud workspace description | `${{ github.event.repository.description}}` |
| `execution_mode` | Execution mode to use for the workspace | |
| `file_triggers_enabled` | Whether to filter runs based on the changed files in a VCS push | |
| `global_remote_state` | Whether all workspaces in the organization can access the workspace via remote state | `false` |
| `import` | Whether to import existing matching resources from the Terraform Cloud organization. Ran as a dry run if `apply` is false. | `true` |
| `name` | Name of the workspace. Becomes a prefix if workspaces are passed (`${name}-${workspace}`) | `"${{ github.event.repository.name }}" `|
| `notification_configuration` | A YAML encoded map of notification settings applied to all created workspaces | |
| `queue_all_runs` | Whether the workspace should start automatically performing runs immediately after creation | |
| `remote_state_consumer_ids` | Comma separated list of workspace IDs to allow read access to the workspace outputs | |
| `remote_states` | YAML encoded remote state blocks to configure in the workspace | |
| `runner_terraform_version` | Terraform version used to create the workspace | `1.0.3` |
| `run_triggers` | YAML encoded list of either workspace IDs or names that, when applied, trigger runs in all the created workspaces (max 20) | |
| `speculative_enabled` | Whether the workspace allows speculative plans | |
| `ssh_key_id` | SSH key ID to assign the workspace | |
| `tags` | YAML encoded list of tag names applied to all workspaces | |
| `team_access` | YAML encoded teams and their associated permissions to be granted to the created workspaces | `false` |
| `terraform_version` | Workspace Terraform version | `1` |
| `terraform_host` | Terraform Cloud host | `app.terraform.io` |
| `tfe_provider_version` | Terraform Cloud provider version | `0.25.3` |
| `variables` | YAML encoded variables to apply to all workspaces | |
| `vcs_ingress_submodules` | Whether to allow submodule ingress | `false` |
| `vcs_repo` | Repository identifier for a VCS integration | `"${{ github.repository }}"` |
| `vcs_token_id` | Terraform VCS client token ID. Takes precedence over `vcs_name`. If neither are passed, no VCS integration is added. | |
| `vcs_type` | Terraform VCS type (e.g., "github"). Superseded by `vcs_token_id`. If neither are passed, no VCS integration is added | |
| `working_directory` | A relative path that Terraform will execute within. Defaults to the root of your repository | |
| `workspace_tags` | YAML encoded map of workspace names to a list of tag names, which are applied to the specified workspace | |
| `workspace_variables` | YAML encoded variables to apply to specific workspaces, with variables nested under workspace names | |
| `workspace_run_triggers` | A YAML encoded map of workspaces to workspace IDs or names, which like `run_triggers`, will trigger a run for the associated workspace when the source workspace is applied | |
| `workspaces` | YAML encoded list of workspace names | |

## Outputs

| Name | Description |
| --- | --- |
| `plan` | A human friendly output of the Terraform plan |
| `plan_json` | A JSON representation of the Terraform plan |

## Development

### Test

To test the project

`go test -v -short ./...`

### Lint

This project uses [`golangci-lint`](https://github.com/golangci/golangci-lint)

To lint the project

`golangci-lint run ./...`

To auto fix issues where supported

`golangci-lint run  --fix ./...`
MD
cat > action.yml <<'YAML'
name: Terraform Cloud Workspace
description: Manages Terraform Cloud workspaces
inputs:
  terraform_version:
    description: Workspace Terraform version. This can be either an exact version or a version constraint (like ~> 1.0.0).
    default: "1"
  terraform_token:
    description: Terraform Cloud token.
    required: true
  terraform_organization:
    description: Terraform Cloud organization.
    required: true
  name:
    description: Name of the workspace. Becomes a prefix if workspaces are passed (`${name}-${workspace}`).
    default: "${{ github.event.repository.name }}"
  tags:
    description: YAML encoded list of tag names applied to all workspaces
    default: ""
  workspace_tags:
    description: YAML encoded map of workspace names to a list of tag names, which are applied to the specified workspace
    default: ""
  runner_terraform_version:
    description: Terraform version used to create the workspace.
    default: "1.1.8"
  workspaces:
    description: YAML encoded list of workspace names.
    default: ""
  apply:
    description: Whether to apply the proposed Terraform changes.
    required: true
  import:
    description: Whether to import existing matching resources from the Terraform Cloud organization.
    default: true
  variables:
    description: YAML encoded variables to apply to all workspaces.
    default: ""
  workspace_variables:
    description: YAML encoded variables to apply to specific workspaces, with variables nested under workspace names.
    default: ""
outputs:
  plan:
    description: A human friendly output of the Terraform plan.
  plan_json:
    description: A JSON representation of the Terraform plan.
runs:
  using: docker
  image: Dockerfile
YAML
git add -A && git commit -qm "Initial state"
git switch -qc input-table
mkdir -p .github/workflows
cat > .github/workflows/docs.yml <<'YAML'
name: Documentation
on:
  push:
    branches:
      - master
    paths:
      - .githhub/workflows/docs.yml
      - README.md
      - action.yml
  pull_request:
    paths:
      - .githhub/workflows/docs.yml
      - README.md
      - action.yml
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: npalm/action-docs-action@v1.2.0
      - name: Verify documentation is up to date
        run: git diff --exit-code
YAML
cat > Makefile <<'MAKE'
docs:
	npx action-docs --update-readme
MAKE
cat > README.md <<'MD'
# Terraform Cloud Workspace Action

A GitHub action for managing Terraform Cloud workspaces

## Usage

```yaml
name: TFLint
on: [push]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: takescoop/terraform-cloud-workspace-action@v0
        with:
          terraform_token: "${{ secrets.TF_TOKEN }}"
          terraform_organization: "my-org"
          apply: "${{ github.ref == format('refs/heads/{0}', github.event.repository.default_branch) }}"
          backend_config: |-
            s3:
              bucket: my-bucket
              key: foo.tfstate
              region: us-east-1
```

## Inputs

<!-- action-docs-inputs -->
## Inputs

| parameter | description | required | default |
| - | - | - | - |
| terraform_version | Workspace Terraform version. This can be either an exact version or a version constraint (like ~> 1.0.0). | `false` | 1 |
| terraform_token | Terraform Cloud token. | `true` |  |
| terraform_host | Terraform Cloud host. | `false` | app.terraform.io |
| terraform_organization | Terraform Cloud organization. | `true` |  |
| tfe_provider_version | Terraform Cloud provider version. | `false` | 0.30.2 |
| name | Name of the workspace. Becomes a prefix if workspaces are passed (`${name}-${workspace}`). | `false` | ${{ github.event.repository.name }} |
| description | Terraform Cloud workspace description | `false` | ${{ github.event.repository.description }} |
| tags | YAML encoded list of tag names applied to all workspaces | `false` |  |
| workspace_tags | YAML encoded map of workspace names to a list of tag names, which are applied to the specified workspace | `false` |  |
| runner_terraform_version | Terraform version used in GitHub Actions to manage the workspace and related resources. | `false` | 1.1.8 |
| workspaces | YAML encoded list of workspace names. | `false` |  |
| backend_config | YAML encoded backend configurations. | `false` |  |
| apply | Whether to apply the proposed Terraform changes. | `true` |  |
| import | Whether to import existing matching resources from the Terraform Cloud organization. | `false` | true |
| variables | YAML encoded variables to apply to all workspaces. | `false` |  |
| workspace_variables | YAML encoded map of variables to apply to specific workspaces, with each key corresponding to a workspace. | `false` |  |
| vcs_type | Terraform VCS type (e.g., "github"). Superseded by `vcs_token_id`. If neither are passed, no VCS integration is added. | `false` |  |
| vcs_token_id | Terraform VCS client token ID. Takes precedence over `vcs_name`. If neither are passed, no VCS integration is added. | `false` |  |
| vcs_repo | Repository identifier for a VCS integration. | `false` | ${{ github.repository }} |
| vcs_ingress_submodules | Whether to allow submodule ingress. | `false` | false |
| working_directory | A relative path that Terraform will execute within. Defaults to the root of your repository. | `false` |  |
| agent_pool_id | ID of an agent pool to assign to the workspace. If passed, execution_mode is set to "agent". | `false` |  |
| execution_mode | Execution mode to use for the workspace. | `false` | remote |
| global_remote_state | Whether all workspaces in the organization can access the workspace via remote state. | `false` | false |
| remote_state_consumer_ids | Comma separated list of workspace IDs to allow read access to the workspace outputs. | `false` |  |
| auto_apply | Whether to set auto_apply on the workspace or workspaces. | `false` | true |
| queue_all_runs | Whether the workspace should start automatically performing runs immediately after creation. | `false` |  |
| speculative_enabled | Whether the workspace allows speculative plans. | `false` |  |
| ssh_key_id | SSH key ID to assign the workspace. | `false` |  |
| file_triggers_enabled | Whether to filter runs based on the changed files in a VCS push. | `false` |  |
| remote_states | YAML encoded remote state blocks to configure in the workspace. | `false` |  |
| team_access | YAML encoded teams and their associated permissions to be granted to the created workspaces. | `false` |  |
| allow_workspace_deletion | Whether to allow workspaces to be deleted. If enabled, workspace state may be irrecoverably deleted. | `false` | false |
| run_triggers | YAML encoded list of either workspace IDs or names that, when applied, trigger runs in all the created workspaces (max 20) | `false` |  |
| workspace_run_triggers | A YAML encoded map of workspaces to workspace IDs or names, which like `run_triggers`, will trigger a run for the associated workspace when the source workspace is ran | `false` |  |
| notification_configuration | A YAML encoded map of notification settings applied to all created workspaces | `false` |  |



<!-- action-docs-inputs -->

## Outputs

<!-- action-docs-outputs -->
## Outputs

| parameter | description |
| - | - |
| plan | A human friendly output of the Terraform plan. |
| plan_json | A JSON representation of the Terraform plan. |



<!-- action-docs-outputs -->

## Development

### Test

To test the project

`go test -v -short ./...`

### Documentation

Documentation is generated from `action.yml` using [action-docs](https://github.com/npalm/action-docs). To generate documentation and update it in place:

```sh
make docs
```

On each pull request, a workflow will automatically update the documentation and fail if the documentation is out of date.

### Lint

This project uses [`golangci-lint`](https://github.com/golangci/golangci-lint)

To lint the project

`golangci-lint run ./...`

To auto fix issues where supported

`golangci-lint run  --fix ./...`
MD
cat > action.yml <<'YAML'
name: Terraform Cloud Workspace
description: Manages Terraform Cloud workspaces
inputs:
  terraform_version:
    description: Workspace Terraform version. This can be either an exact version or a version constraint (like ~> 1.0.0).
    default: "1"
  terraform_token:
    description: Terraform Cloud token.
    required: true
  terraform_organization:
    description: Terraform Cloud organization.
    required: true
  name:
    description: Name of the workspace. Becomes a prefix if workspaces are passed (`${name}-${workspace}`).
    default: "${{ github.event.repository.name }}"
  tags:
    description: YAML encoded list of tag names applied to all workspaces
    default: ""
  workspace_tags:
    description: YAML encoded map of workspace names to a list of tag names, which are applied to the specified workspace
    default: ""
  runner_terraform_version:
    description: Terraform version used in GitHub Actions to manage the workspace and related resources.
    default: "1.1.8"
  workspaces:
    description: YAML encoded list of workspace names.
    default: ""
  apply:
    description: Whether to apply the proposed Terraform changes.
    required: true
  import:
    description: Whether to import existing matching resources from the Terraform Cloud organization.
    default: true
  variables:
    description: YAML encoded variables to apply to all workspaces.
    default: ""
  workspace_variables:
    description: YAML encoded map of variables to apply to specific workspaces, with each key corresponding to a workspace.
    default: ""
outputs:
  plan:
    description: A human friendly output of the Terraform plan.
  plan_json:
    description: A JSON representation of the Terraform plan.
runs:
  using: docker
  image: Dockerfile
YAML
git add -A && git commit -qm "Generate readme input/output docs"
