---
name: terraform
description: Working with Terraform configuration, CLI, modules, and providers. Use when writing or reviewing HCL configuration, managing infrastructure as code, debugging Terraform plans/applies, or working with Terraform-related tools.
---
# Terraform

## Version-Specific Guidance

**CRITICAL**: Before providing any language syntax or CLI advice, run `terraform version` to determine the project's Terraform version.

```bash
terraform version
```

Assume modern Terraform (1.x). Key features by version:
- **1.0+**: Stability guarantees, no breaking changes within 1.x
- **1.3+**: Optional object attributes, `terraform test` command
- **1.5+**: `import` blocks (preferred over CLI import), `check` blocks
- **1.6+**: Test mocking, config-driven `remove` blocks
- **1.7+**: Enhanced `removed` block support, improved variable validation
- **1.8+**: Provider functions

If the project uses Terraform < 1.0, note the version and adjust recommendations accordingly, but optimize guidance for 1.x features.

## Configuration Language (HCL)

### Style and Formatting

- Run `terraform fmt` before committing changes
- Use 2-space indentation (enforced by `fmt`)
- Use snake_case for all identifiers (resources, variables, outputs, locals)
- Quote string values; leave boolean/number values unquoted

### Resource Organization

**Single resource per block**:
```hcl
resource "aws_instance" "web" {
  ami           = var.ami_id
  instance_type = "t3.micro"
}
```

**Group related resources in the same file**:
```
main.tf           # Primary resources
variables.tf      # Input variable declarations
outputs.tf        # Output value declarations
versions.tf       # Terraform and provider version constraints
terraform.tfvars  # Variable value assignments (gitignored if sensitive)
```

**For larger modules, organize by logical component**:
```
compute.tf
networking.tf
security.tf
data.tf          # Data sources
locals.tf        # Local values
```

### Variables and Outputs

**Declare types explicitly**:
```hcl
variable "instance_count" {
  description = "Number of instances to create"
  type        = number
  default     = 1
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
```

**Use validation when appropriate**:
```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}
```

**Mark sensitive values**:
```hcl
output "database_password" {
  value     = aws_db_instance.main.password
  sensitive = true
}
```

### Dependencies and Ordering

**Prefer implicit dependencies** (referencing attributes):
```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.public.id  # Implicit dependency
}
```

**Use `depends_on` only when necessary** (no attribute reference available):
```hcl
resource "aws_instance" "web" {
  # ...
  depends_on = [aws_iam_role_policy.example]
}
```

### Iteration Patterns

**Use `for_each` for creating multiple similar resources**:
```hcl
resource "aws_instance" "server" {
  for_each = toset(["web", "api", "worker"])

  tags = {
    Name = "server-${each.key}"
    Role = each.key
  }
}
```

**Avoid `count` for resource sets** (makes refactoring difficult). Use `count` only for conditional resource creation:
```hcl
resource "aws_instance" "bastion" {
  count = var.enable_bastion ? 1 : 0
  # ...
}
```

### Data Sources

Use data sources to reference existing infrastructure:
```hcl
data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hcl-ssd/ubuntu-focal-20.04-amd64-server-*"]
  }

  owners = ["099720109477"] # Canonical
}
```

### Local Values

Use locals for computed values used multiple times:
```hcl
locals {
  common_tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = var.project_name
  }

  name_prefix = "${var.project_name}-${var.environment}"
}
```

## CLI Workflow

### Standard Development Cycle

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

### Best Practices

**Always review plans before applying**:
- Never run `terraform apply` without reviewing the plan
- Use `-out=tfplan` to save plans for exact application
- Check for unexpected resource destruction (red `-` markers)

**Use workspaces for environment separation** (simple cases):
```bash
terraform workspace new staging
terraform workspace select prod
```

**Use separate state backends for true isolation** (recommended):
- Different backend configurations per environment
- Prevents accidental cross-environment changes

**Lock state backends**:
- Use backends that support locking (S3 + DynamoDB, Terraform Cloud, etc.)
- Prevents concurrent modifications

## Modules

### Module Structure

**Minimal module**:
```
modules/vpc/
├── main.tf        # Resources
├── variables.tf   # Input variables
├── outputs.tf     # Output values
└── README.md      # Usage documentation
```

**Production module**:
```
modules/vpc/
├── main.tf
├── variables.tf
├── outputs.tf
├── versions.tf    # Provider requirements
├── README.md
└── examples/      # Usage examples
    └── complete/
        ├── main.tf
        └── README.md
```

### Module Calls

```hcl
module "vpc" {
  source = "./modules/vpc"

  cidr_block = "10.0.0.0/16"
  name       = local.name_prefix

  tags = local.common_tags
}

# Reference module outputs
resource "aws_instance" "web" {
  subnet_id = module.vpc.public_subnet_ids[0]
}
```

### Module Sources

- **Local**: `./modules/networking`
- **Registry**: `hashicorp/consul/aws` (see `registry.md`)
- **Git**: `git::https://github.com/org/repo.git//modules/vpc?ref=v1.2.0`
- **S3**: `s3::https://s3.amazonaws.com/bucket/path/module.zip`

Always pin module versions in production:
```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"  # Accept 5.x updates, but not 6.0
}
```

## State Management

**Never edit state files manually**. Use `terraform state` commands or import blocks.

**Import existing resources** using `import` blocks (Terraform 1.5+, preferred):
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

## Troubleshooting

### Common Issues

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

### Debug Output

```bash
# Enable detailed logging
TF_LOG=DEBUG terraform plan

# Log to file
TF_LOG=DEBUG TF_LOG_PATH=./terraform.log terraform apply
```

## Testing

**Built-in testing** (Terraform 1.6+):
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

**Alternative testing approaches**:
- **Terratest** (Go-based): Comprehensive integration testing for cloud providers
- **kitchen-terraform** (Ruby-based): Test Kitchen integration
- **terraform test** (built-in): Recommended for most use cases

## Security Considerations

**Never commit sensitive values**:
- Use `.gitignore` for `*.tfvars` files containing secrets
- Store secrets in secure backends (AWS Secrets Manager, Vault, etc.)
- Reference secrets via data sources

**Use variable validation**:
```hcl
variable "cidr_block" {
  type = string

  validation {
    condition     = can(cidrhost(var.cidr_block, 0))
    error_message = "Must be a valid CIDR block."
  }
}
```

**Enable provider features**:
- S3 bucket encryption
- Require MFA for destructive operations
- Use IAM least privilege

**Scan for security issues**:
- `tfsec`: Static analysis for security issues
- `checkov`: Policy-as-code scanning
- `terrascan`: Compliance scanning

## Additional Resources

- **Documentation**: See `docs.md` for navigating official Terraform documentation
- **Registry**: See `registry.md` for finding and using providers/modules from the Terraform Registry
