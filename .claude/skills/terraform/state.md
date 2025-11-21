# Terraform State

Read-only operations for inspecting and querying Terraform state files. Never modify state directly.

## Inspecting State

### List Resources

List all resources in the state:
```bash
terraform state list
```

Filter by resource type:
```bash
terraform state list aws_instance
terraform state list 'aws_instance.web[*]'
```

### Show Resource Details

Display detailed information about a specific resource:
```bash
terraform state show aws_instance.web
terraform state show 'module.vpc.aws_subnet.private[0]'
```

### View Entire State

View the complete state file in JSON format:
```bash
terraform show -json
```

View human-readable state:
```bash
terraform show
```

## Remote State Data Source

Access outputs from another Terraform state file.

### S3 Backend

```hcl
data "terraform_remote_state" "vpc" {
  backend = "s3"

  config = {
    bucket = "my-terraform-state"
    key    = "vpc/terraform.tfstate"
    region = "us-east-1"
  }
}

# Reference outputs from the remote state
resource "aws_instance" "web" {
  subnet_id = data.terraform_remote_state.vpc.outputs.public_subnet_ids[0]
}
```

### Terraform Cloud Backend

```hcl
data "terraform_remote_state" "network" {
  backend = "remote"

  config = {
    organization = "my-org"

    workspaces = {
      name = "network-prod"
    }
  }
}

# Access remote state outputs
locals {
  vpc_id = data.terraform_remote_state.network.outputs.vpc_id
}
```

### Local Backend

```hcl
data "terraform_remote_state" "database" {
  backend = "local"

  config = {
    path = "../database/terraform.tfstate"
  }
}
```

## State File Structure

Terraform state files are JSON documents with the following structure:

```json
{
  "version": 4,
  "terraform_version": "1.14.0",
  "serial": 42,
  "lineage": "uuid",
  "outputs": {
    "vpc_id": {
      "value": "vpc-12345",
      "type": "string"
    }
  },
  "resources": [
    {
      "mode": "managed",
      "type": "aws_instance",
      "name": "web",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "attributes": {
            "id": "i-1234567890abcdef0",
            "ami": "ami-12345678",
            "instance_type": "t3.micro"
          }
        }
      ]
    }
  ]
}
```

### Key Fields

- **version**: State file format version
- **terraform_version**: Terraform version that wrote the state
- **serial**: Incremented on each state change
- **lineage**: UUID that identifies the state file
- **outputs**: Output values from the configuration
- **resources**: All managed resources and their attributes

## Querying State with jq

Extract specific information from state files using jq:

```bash
# Get all resource IDs
terraform show -json | jq -r '.values.root_module.resources[].values.id'

# List all resource types
terraform show -json | jq -r '.values.root_module.resources[].type' | sort -u

# Get specific output value
terraform show -json | jq -r '.values.outputs.vpc_id.value'

# Find resources by tag
terraform show -json | jq '.values.root_module.resources[] | select(.values.tags.Environment == "prod")'
```

## State Backends

### S3 Backend

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

### Terraform Cloud

```hcl
terraform {
  cloud {
    organization = "my-org"

    workspaces {
      name = "prod"
    }
  }
}
```

### Azure Storage

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "terraform-state"
    storage_account_name = "tfstate"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}
```

### Google Cloud Storage

```hcl
terraform {
  backend "gcs" {
    bucket = "my-terraform-state"
    prefix = "prod"
  }
}
```

## Best Practices

### Organize State Files

- Use separate state files per environment (dev, staging, prod)
- Use separate state files per layer (network, compute, data)
- Use workspaces for simple environment separation
- Use separate backends for complete isolation

### State File Security

- Enable encryption at rest for remote backends
- Enable versioning on state storage (S3 versioning, etc.)
- Restrict access using IAM/RBAC policies
- Never commit state files to version control
- Use state locking to prevent concurrent modifications

### Remote State Outputs

When exposing data via remote state:

```hcl
# Expose specific values as outputs
output "vpc_id" {
  value       = aws_vpc.main.id
  description = "VPC ID for use in other configurations"
}

output "subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet IDs"
}

# Mark sensitive outputs
output "database_password" {
  value     = aws_db_instance.main.password
  sensitive = true
}
```

### Debugging State Issues

Check state file integrity:
```bash
# Validate state file
terraform show -json > /dev/null

# Compare state with real infrastructure
terraform plan -refresh-only

# Check for drift
terraform plan
```

Investigate specific resources:
```bash
# Get resource address
terraform state list | grep instance

# Show resource details
terraform state show 'aws_instance.web'

# Check resource dependencies
terraform show -json | jq '.values.root_module.resources[] | select(.address == "aws_instance.web") | .depends_on'
```

## Common Patterns

### Cross-Stack References

```hcl
# In network stack - expose VPC ID
output "vpc_id" {
  value = aws_vpc.main.id
}

# In application stack - consume VPC ID
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "terraform-state"
    key    = "network/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_instance" "app" {
  vpc_security_group_ids = [aws_security_group.app.id]
  subnet_id              = data.terraform_remote_state.network.outputs.subnet_ids[0]
}
```

### Reading Outputs Programmatically

```bash
# Get output value
terraform output vpc_id

# Get output as JSON
terraform output -json

# Get specific output value
terraform output -raw vpc_id
```

### State Refresh

Reconcile state with actual infrastructure:
```bash
# Preview refresh changes
terraform plan -refresh-only

# Apply refresh (read-only, safe)
terraform apply -refresh-only
```
