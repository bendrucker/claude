# The deployment environment session-bench and other jobs on the
# actions-sandbox runner run in. Its AWS role, which trusts only this
# environment, comes from bendrucker/infrastructure, since this workspace can
# create no IAM.
variable "actions_sandbox" {
  type = object({
    environment = string
    role_arn    = string
  })
  description = "The environment name the role trusts, and the role. Written by bendrucker/infrastructure."
}

data "github_repository" "this" {
  name = "claude"
}

# Only main can deploy, so a workflow from a fork pull request never gets a
# token the role accepts.
resource "github_repository_environment" "actions_sandbox" {
  repository  = data.github_repository.this.name
  environment = var.actions_sandbox.environment

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "actions_sandbox_main" {
  repository     = data.github_repository.this.name
  environment    = github_repository_environment.actions_sandbox.environment
  branch_pattern = data.github_repository.this.default_branch
}

resource "github_actions_environment_variable" "actions_sandbox_role" {
  repository    = data.github_repository.this.name
  environment   = github_repository_environment.actions_sandbox.environment
  variable_name = "AWS_ROLE_ARN"
  value         = var.actions_sandbox.role_arn
}
