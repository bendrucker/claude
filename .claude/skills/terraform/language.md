# Terraform Configuration Language (HCL)

Detailed patterns and best practices for writing Terraform configuration.

## Variables and Outputs

### Declare Types Explicitly

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

### Use Validation

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "cidr_block" {
  type = string

  validation {
    condition     = can(cidrhost(var.cidr_block, 0))
    error_message = "Must be a valid CIDR block."
  }
}
```

### Mark Sensitive Values

```hcl
output "database_password" {
  value     = aws_db_instance.main.password
  sensitive = true
}
```

## Dependencies and Ordering

### Prefer Implicit Dependencies

Referencing attributes:
```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.public.id  # Implicit dependency
}
```

### Use depends_on When Necessary

Only when no attribute reference is available:
```hcl
resource "aws_instance" "web" {
  # ...
  depends_on = [aws_iam_role_policy.example]
}
```

## Iteration Patterns

### Use for_each for Resource Sets

```hcl
resource "aws_instance" "server" {
  for_each = toset(["web", "api", "worker"])

  tags = {
    Name = "server-${each.key}"
    Role = each.key
  }
}
```

### Use count for Conditional Creation

```hcl
resource "aws_instance" "bastion" {
  count = var.enable_bastion ? 1 : 0
  # ...
}
```

### Dynamic Blocks for Nested Blocks

```hcl
resource "aws_security_group" "main" {
  name = "main"

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.from_port
      to_port     = ingress.value.to_port
      protocol    = ingress.value.protocol
      cidr_blocks = ingress.value.cidr_blocks
    }
  }
}
```

## Data Sources

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

resource "aws_instance" "web" {
  ami = data.aws_ami.ubuntu.id
}
```

## Local Values

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

resource "aws_instance" "web" {
  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-web"
    }
  )
}
```

## Resource Meta-Arguments

### Lifecycle Rules

```hcl
resource "aws_instance" "web" {
  # ...

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
    ignore_changes        = [tags]
  }
}
```

### Provider Aliases

For multiple regions or accounts:
```hcl
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "west"
  region = "us-west-2"
}

resource "aws_instance" "web" {
  provider = aws.west
  # ...
}
```

## Common Patterns

### Conditional Expressions

```hcl
resource "aws_instance" "web" {
  instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"
}
```

### Optional Attributes

```hcl
variable "config" {
  type = object({
    name     = string
    size     = optional(number, 10)  # Default: 10
    enabled  = optional(bool, true)   # Default: true
  })
}
```

### Type Conversions

```hcl
locals {
  # String to number
  port = tonumber(var.port_string)

  # List to set (for for_each)
  subnet_set = toset(var.subnet_ids)

  # Map to list of objects
  instances = [for k, v in var.instance_config : {
    name = k
    type = v.type
    size = v.size
  }]
}
```
