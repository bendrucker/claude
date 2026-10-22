provider "aws" {
  region = "us-east-1"
}

# Reads GITHUB_TOKEN from a sensitive variable on this workspace: a
# fine-grained token scoped to this one repository.
provider "github" {
  owner = "bendrucker"
}
