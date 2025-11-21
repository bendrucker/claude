# Terraform Operations

Detailed guidance for CLI workflows, modules, state management, testing, and troubleshooting.

## CLI Workflow

**Standard development cycle**:
```bash
# Initialize and download providers/modules
terraform init

# Validate configuration syntax
terraform validate

# Format configuration files
terraform fmt -recursive

# Preview changes
terraform plan -out=tfplan

# Apply planned changes
terraform apply tfplan

# View current state
terraform show

# List resources in state
terraform state list
```

**Best practices**:
- Never run `terraform apply` without reviewing the plan
- Use `-out=tfplan` to save plans for exact application
- Check for unexpected resource destruction (red `-` markers)
- Use workspaces for simple environment separation (same backend)
- Use separate state backends for true environment isolation

**Lock state backends**:
- Use backends that support locking (S3 + DynamoDB, Terraform Cloud, etc.)
- Prevents concurrent modifications

## Modules

**Module structure**:
```
modules/vpc/
├── main.tf        # Resources
├── variables.tf   # Input variables
├── outputs.tf     # Output values
├── versions.tf    # Provider requirements
├── README.md      # Usage documentation
└── examples/      # Usage examples
    └── complete/
        ├── main.tf
        └── README.md
```

**Module calls**:
```hcl
module "vpc" {
  source = "./modules/vpc"

  cidr_block = "10.0.0.0/16"
  name       = local.name_prefix
  tags       = local.common_tags
}

# Reference module outputs
resource "aws_instance" "web" {
  subnet_id = module.vpc.public_subnet_ids[0]
}
```

**Module sources**:
- **Local**: `./modules/networking`
- **Registry**: `hashicorp/consul/aws` (see `registry.md`)
- **Git**: `git::https://github.com/org/repo.git//modules/vpc?ref=v1.2.0`
- **S3**: `s3::https://s3.amazonaws.com/bucket/path/module.zip`

**Always pin module versions in production**:
```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"  # Accept 5.x updates, but not 6.0
}
```

## State Management

**Never edit state files manually**. Use `terraform state` commands or import blocks.

**Import existing resources** using `import` blocks (preferred):
```hcl
import {
  to = aws_instance.web
  id = "i-1234567890abcdef0"
}
```

Run `terraform plan` to generate the configuration, then `terraform apply` to complete the import.

**State manipulation commands**:
```bash
# Move resource to different address
terraform state mv aws_instance.old aws_instance.new

# Remove resource from state (keeps actual infrastructure)
terraform state rm aws_instance.old

# CLI import (legacy, use import blocks instead)
terraform import aws_instance.web i-1234567890abcdef0
```

**Removing resources from management**:
```hcl
removed {
  from = aws_instance.old

  lifecycle {
    destroy = false  # Keep resource, just remove from state
  }
}
```

## Testing

**Built-in testing**:
```hcl
# tests/main.tftest.hcl
run "validate_instance_type" {
  command = plan

  assert {
    condition     = aws_instance.web.instance_type == "t3.micro"
    error_message = "Instance type must be t3.micro"
  }
}
```

Run tests with:
```bash
terraform test
```

**Test with mocks**:
```hcl
run "test_with_mock" {
  command = plan

  override_resource {
    target = aws_instance.web
    values = {
      ami = "ami-mock"
    }
  }
}
```

**Alternative testing approaches**:
- **Terratest** (Go-based): Comprehensive integration testing for cloud providers
- **kitchen-terraform** (Ruby-based): Test Kitchen integration
- **terraform test** (built-in): Recommended for most use cases

## Troubleshooting

**State lock errors**:
```bash
# Force unlock (use cautiously, ensure no other operations running)
terraform force-unlock LOCK_ID
```

**Provider version conflicts**:
```bash
# Regenerate lock file
terraform init -upgrade

# View provider dependency tree
terraform providers
```

**Plan shows unwanted changes**:
- Check for provider drift (external modifications)
- Review lifecycle rules (`prevent_destroy`, `ignore_changes`)
- Verify variable values match expectations

**Debug output**:
```bash
# Enable detailed logging
TF_LOG=DEBUG terraform plan

# Log to file
TF_LOG=DEBUG TF_LOG_PATH=./terraform.log terraform apply
```

**Common issues**:
- **Module not found**: Run `terraform init` to download modules
- **Provider not installed**: Run `terraform init` to install providers
- **Circular dependencies**: Refactor to break the cycle, use `-target` as temporary workaround
- **Resource already exists**: Import the resource or remove from configuration

## Security

**Never commit sensitive values**:
- Use `.gitignore` for `*.tfvars` files containing secrets
- Store secrets in secure backends (AWS Secrets Manager, Vault, etc.)
- Reference secrets via data sources

**Secure backend configuration**:
```hcl
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}
```

**Provider security features**:
- Enable S3 bucket encryption
- Require MFA for destructive operations
- Use IAM least privilege
- Enable provider-level assume role

**Scan for security issues**:
```bash
# Static analysis
tfsec .

# Policy-as-code scanning
checkov -d .

# Compliance scanning
terrascan scan
```

**Check blocks** for runtime validation:
```hcl
check "health_check" {
  data "http" "example" {
    url = "https://${aws_instance.web.public_ip}/health"
  }

  assert {
    condition     = data.http.example.status_code == 200
    error_message = "Health check failed"
  }
}
```
