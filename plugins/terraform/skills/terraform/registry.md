# Terraform Registry

Reference guide for navigating the Terraform Registry and using its APIs to find providers, modules, and documentation.

## Registry Overview

**Public Registry**: `https://registry.terraform.io`

The Terraform Registry hosts:
- **Providers**: Plugins that interact with APIs (AWS, Azure, GCP, etc.)
- **Modules**: Reusable Terraform configurations
- **Policy Libraries**: Sentinel/OPA policies for governance

## URL Patterns

### Provider URLs

```
# Provider namespace page
https://registry.terraform.io/providers/[namespace]

# Specific provider
https://registry.terraform.io/providers/[namespace]/[name]

# Provider version
https://registry.terraform.io/providers/[namespace]/[name]/[version]

# Provider documentation
https://registry.terraform.io/providers/[namespace]/[name]/latest/docs

# Specific resource/data source docs
https://registry.terraform.io/providers/[namespace]/[name]/latest/docs/resources/[resource]
https://registry.terraform.io/providers/[namespace]/[name]/latest/docs/data-sources/[data-source]
```

**Examples**:
```
# AWS provider
https://registry.terraform.io/providers/hashicorp/aws
https://registry.terraform.io/providers/hashicorp/aws/latest/docs
https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance

# Community provider
https://registry.terraform.io/providers/cloudflare/cloudflare
```

### Module URLs

```
# Module in registry
https://registry.terraform.io/modules/[namespace]/[name]/[provider]

# Specific version
https://registry.terraform.io/modules/[namespace]/[name]/[provider]/[version]
```

**Examples**:
```
# VPC module
https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws
https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/5.1.2
```

## Registry APIs

The Terraform Registry provides HTTP APIs for programmatic access. These are the same APIs Terraform CLI uses during operations.

### Service Discovery

The Registry uses a service discovery protocol. Base endpoint:

```
https://registry.terraform.io/.well-known/terraform.json
```

This returns available service endpoints:
- `modules.v1`: Module registry API base URL
- `providers.v1`: Provider registry API base URL

### Module Registry API

**Base URL**: `https://registry.terraform.io/v1/modules/`

#### List Module Versions

Get all available versions for a module:

```
GET /v1/modules/{namespace}/{name}/{provider}/versions

Example:
GET https://registry.terraform.io/v1/modules/terraform-aws-modules/vpc/aws/versions
```

**Response structure**:
```json
{
  "modules": [
    {
      "versions": [
        {"version": "5.1.2"},
        {"version": "5.1.1"}
      ]
    }
  ]
}
```

#### Get Module Details

Retrieve full module information:

```
GET /v1/modules/{namespace}/{name}/{provider}/{version}

Example:
GET https://registry.terraform.io/v1/modules/terraform-aws-modules/vpc/aws/5.1.2
```

**Response includes**:
- Module metadata (description, source, owner)
- Root module inputs, outputs, dependencies, resources
- Submodule information
- Provider requirements
- Download statistics
- README content

#### Download Module

Get download URL for module source:

```
GET /v1/modules/{namespace}/{name}/{provider}/{version}/download

Example:
GET https://registry.terraform.io/v1/modules/terraform-aws-modules/vpc/aws/5.1.2/download
```

Returns a `Location` header with the download URL (usually GitHub).

#### Search Modules

Search across all modules:

```
GET /v1/modules/search?q={query}&provider={provider}

Example:
GET https://registry.terraform.io/v1/modules/search?q=vpc&provider=aws
```

**Query parameters**:
- `q`: Search query (searches name, description, README)
- `provider`: Filter by provider (aws, azurerm, google, etc.)
- `namespace`: Filter by namespace
- `verified`: Filter verified modules only
- `offset`: Pagination offset
- `limit`: Results per page (max 50)

#### List All Modules

Browse modules by namespace:

```
GET /v1/modules/{namespace}

Example:
GET https://registry.terraform.io/v1/modules/terraform-aws-modules
```

### Provider Registry API

**Base URL**: `https://registry.terraform.io/v1/providers/`

#### List Provider Versions

Get available versions for a provider:

```
GET /v1/providers/{namespace}/{name}/versions

Example:
GET https://registry.terraform.io/v1/providers/hashicorp/aws/versions
```

**Response structure**:
```json
{
  "versions": [
    {
      "version": "5.31.0",
      "protocols": ["5.0"],
      "platforms": [
        {"os": "linux", "arch": "amd64"},
        {"os": "darwin", "arch": "arm64"}
      ]
    }
  ]
}
```

#### Get Provider Package

Retrieve download information for a specific version and platform:

```
GET /v1/providers/{namespace}/{name}/{version}/download/{os}/{arch}

Example:
GET https://registry.terraform.io/v1/providers/hashicorp/aws/5.31.0/download/linux/amd64
```

Returns download URL, SHA256 checksum, and signing keys.

#### List Providers

Browse providers by namespace:

```
GET /v1/providers/{namespace}

Example:
GET https://registry.terraform.io/v1/providers/hashicorp
```

## Using the Registry

### Finding Providers

**Official Providers** (namespace: `hashicorp`):
- **aws**: Amazon Web Services
- **azurerm**: Microsoft Azure
- **google**: Google Cloud Platform
- **kubernetes**: Kubernetes
- **helm**: Helm (Kubernetes package manager)
- **null**: Null provider (for local operations)
- **random**: Random value generation
- **time**: Time-based resources
- **external**: External program integration

**Partner/Community Providers**:
Search by vendor name or technology. Examples:
- `cloudflare/cloudflare`: Cloudflare
- `datadog/datadog`: Datadog monitoring
- `mongodb/mongodbatlas`: MongoDB Atlas
- `auth0/auth0`: Auth0 identity platform

### Finding Modules

**Module Naming Convention**:
```
terraform-{PROVIDER}-{NAME}

Examples:
terraform-aws-vpc
terraform-azurerm-network
terraform-google-network
```

**Quality Indicators**:
- **Verified badge**: HashiCorp-verified, actively maintained
- **Download count**: Popularity indicator
- **Recent updates**: Check last commit/release date
- **Examples directory**: Well-documented modules include examples
- **Tests**: Look for integration tests (Terratest, kitchen-terraform)

**Recommended Module Publishers**:
- `terraform-aws-modules/*`: Comprehensive AWS modules
- `Azure/*/azurerm`: Official Azure modules
- `terraform-google-modules/*`: Google Cloud modules

### Module Source Syntax

When using modules in configuration:

```hcl
# Registry module (recommended for public modules)
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.2"
  # ...
}

# Registry module with version constraint
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"  # Any 5.x version
  # ...
}

# Submodule from registry
module "vpc_endpoints" {
  source  = "terraform-aws-modules/vpc/aws//modules/vpc-endpoints"
  version = "5.1.2"
  # ...
}
```

## Provider Documentation Access

Provider documentation is extensive and includes:
- **Resources**: Infrastructure components you can create
- **Data Sources**: Read-only information from the provider
- **Guides**: Common patterns and workflows

### Accessing Provider Docs

**Via WebFetch**:
```
# Get resource documentation
WebFetch: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance
Prompt: "Extract the argument reference, including required and optional arguments. Include examples."

# Get data source documentation
WebFetch: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami
Prompt: "List all available filter criteria and explain the syntax for finding AMIs."

# Get provider configuration
WebFetch: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
Prompt: "Explain authentication methods and required provider configuration arguments."
```

### Common Provider Documentation Sections

```
/providers/{namespace}/{name}/latest/docs
  ├── /                          # Provider overview and configuration
  ├── /guides/                   # Detailed guides and tutorials
  │   ├── /getting-started
  │   ├── /authentication
  │   └── /migration
  ├── /resources/                # All creatable resources
  │   ├── /instance
  │   ├── /security_group
  │   └── /...
  └── /data-sources/             # All data sources
      ├── /ami
      ├── /availability_zones
      └── /...
```

## API Usage Examples

### Get Latest Module Version

```bash
curl https://registry.terraform.io/v1/modules/terraform-aws-modules/vpc/aws/versions \
  | jq -r '.modules[0].versions[0].version'
```

### Search for VPC Modules

```bash
curl "https://registry.terraform.io/v1/modules/search?q=vpc&provider=aws&verified=true" \
  | jq '.modules[] | {name: .name, namespace: .namespace, downloads: .downloads}'
```

### Get Module README

```bash
curl https://registry.terraform.io/v1/modules/terraform-aws-modules/vpc/aws/5.1.2 \
  | jq -r '.root.readme'
```

### Check Provider Versions

```bash
curl https://registry.terraform.io/v1/providers/hashicorp/aws/versions \
  | jq -r '.versions[].version' \
  | head -10
```

## Best Practices

### Version Pinning

**For modules**:
```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"  # Recommended: allows patch updates
  # version = "5.1.2"  # Strict pinning
}
```

**For providers** (in `versions.tf`):
```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

### Evaluating Modules

Before using a registry module:

1. **Review source code**: Click "Source Code" link (usually GitHub)
2. **Check examples**: Look for `examples/` directory
3. **Read issues**: Check GitHub issues for known problems
4. **Verify maintenance**: Check last commit date
5. **Test in non-production first**: Validate behavior before prod use

### Private Registries

Organizations can use private registries:

**HCP Terraform/Terraform Enterprise**:
```hcl
module "internal" {
  source  = "app.terraform.io/my-org/vpc/aws"
  version = "1.0.0"
}
```

**Other private registries**: Configure in Terraform CLI configuration
```hcl
# .terraformrc or terraform.rc
credentials "registry.example.com" {
  token = "..."
}
```

## Troubleshooting

### Module Not Found

- Verify namespace/name/provider are correct
- Check if module is still published (some get deprecated)
- Try searching instead of direct URL

### Provider Download Fails

- Check platform compatibility (OS/architecture)
- Verify version exists for your platform
- Try `terraform init -upgrade` to refresh provider cache

### Documentation Missing

- Some providers have sparse documentation
- Check provider's GitHub repository for additional docs
- Review provider source code for undocumented features
