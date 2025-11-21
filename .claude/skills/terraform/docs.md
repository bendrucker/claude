# Terraform Documentation

Reference guide for efficiently navigating and accessing official Terraform documentation at developer.hashicorp.com/terraform.

## Documentation Structure

The Terraform documentation follows a hierarchical organization:

**Base URL**: `https://developer.hashicorp.com/terraform/`

### Main Documentation Sections

| Section | Path | Purpose |
|---------|------|---------|
| **Language** | `/terraform/language/` | HCL configuration syntax, expressions, functions |
| **CLI** | `/terraform/cli/` | Command-line interface reference and workflows |
| **Internals** | `/terraform/internals/` | Architecture, protocols, technical deep-dives |
| **Plugin Development** | `/terraform/plugin/` | Creating custom providers and provisioners |
| **Registry Publishing** | `/terraform/registry/` | Publishing providers and modules |
| **Cloud/Enterprise** | `/terraform/cloud-docs/`<br>`/terraform/enterprise/` | Managed platform documentation |

### URL Pattern Reference

Documentation URLs follow predictable patterns for easy navigation:

```
# General pattern
https://developer.hashicorp.com/terraform/[section]/[topic]/[subtopic]

# Examples
https://developer.hashicorp.com/terraform/language/modules/develop
https://developer.hashicorp.com/terraform/cli/commands/init
https://developer.hashicorp.com/terraform/language/functions/lookup
```

## Key Documentation Pages

### Language Reference

**Core Concepts**:
- **Resources**: `/terraform/language/resources/syntax`
- **Variables**: `/terraform/language/values/variables`
- **Outputs**: `/terraform/language/values/outputs`
- **Data Sources**: `/terraform/language/data-sources`
- **Modules**: `/terraform/language/modules`
- **Expressions**: `/terraform/language/expressions`

**Functions** (by category):
- **Base path**: `/terraform/language/functions/`
- **Numeric**: `abs`, `ceil`, `floor`, `max`, `min`
- **String**: `format`, `join`, `split`, `replace`, `regex`
- **Collection**: `concat`, `merge`, `lookup`, `element`, `length`
- **Encoding**: `jsonencode`, `jsondecode`, `yamlencode`, `yamldecode`
- **Filesystem**: `file`, `fileexists`, `templatefile`
- **Type Conversion**: `tostring`, `tonumber`, `tobool`, `tolist`, `toset`, `tomap`

**Meta-Arguments**:
- **depends_on**: `/terraform/language/meta-arguments/depends_on`
- **count**: `/terraform/language/meta-arguments/count`
- **for_each**: `/terraform/language/meta-arguments/for_each`
- **lifecycle**: `/terraform/language/meta-arguments/lifecycle`

### CLI Commands

**Core Commands**:
```
/terraform/cli/commands/init      # Initialize working directory
/terraform/cli/commands/plan      # Preview infrastructure changes
/terraform/cli/commands/apply     # Create/update infrastructure
/terraform/cli/commands/destroy   # Destroy managed infrastructure
/terraform/cli/commands/validate  # Validate configuration
/terraform/cli/commands/fmt       # Format configuration files
```

**State Management**:
```
/terraform/cli/commands/state         # State command overview
/terraform/cli/commands/state/list    # List resources in state
/terraform/cli/commands/state/show    # Show resource details
/terraform/cli/commands/state/mv      # Move/rename resources
/terraform/cli/commands/state/rm      # Remove resources from state
```

**Workspace Management**:
```
/terraform/cli/commands/workspace         # Workspace overview
/terraform/cli/commands/workspace/new     # Create workspace
/terraform/cli/commands/workspace/select  # Switch workspace
```

### Version-Specific Features

When checking version-specific features, navigate to upgrade guides:

```
/terraform/language/upgrade-guides/        # All upgrade guides
/terraform/language/upgrade-guides/1-8     # Terraform 1.8 changes
/terraform/language/upgrade-guides/1-7     # Terraform 1.7 changes
/terraform/language/upgrade-guides/1-5     # Terraform 1.5 changes
```

## Accessing Documentation

### Using WebFetch

When you need specific documentation content, use the WebFetch tool with targeted URLs:

```
# Get function documentation
WebFetch: https://developer.hashicorp.com/terraform/language/functions/lookup
Prompt: "Explain the syntax, arguments, and return value of the lookup function. Provide examples."

# Get CLI command details
WebFetch: https://developer.hashicorp.com/terraform/cli/commands/plan
Prompt: "List all available flags for terraform plan with descriptions of their behavior."

# Get language feature documentation
WebFetch: https://developer.hashicorp.com/terraform/language/meta-arguments/for_each
Prompt: "Explain how for_each works, its requirements, and provide examples of common patterns."
```

### Search Strategy

Since raw markdown is not directly accessible, use these approaches:

**1. Construct URLs from patterns**:
- Known section + topic: Build URL directly
- Example: Module sources → `/terraform/language/modules/sources`

**2. WebFetch with specific prompts**:
- Fetch the documentation page
- Ask for structured information (tables, code examples, flag lists)
- Extract key details without full HTML parsing

**3. Use multiple targeted requests**:
- Break complex topics into smaller WebFetch requests
- One page per specific sub-topic
- Combine results for comprehensive understanding

## Common Documentation Lookups

### Finding Function Signatures

```
URL: /terraform/language/functions/[function-name]
Example: /terraform/language/functions/templatefile

What to extract:
- Function signature: templatefile(path, vars)
- Argument types and descriptions
- Return value type
- Examples of usage
- Related functions
```

### Understanding Configuration Blocks

```
URL: /terraform/language/[block-type]/[topic]
Example: /terraform/language/resources/syntax

What to extract:
- Block syntax structure
- Required vs optional arguments
- Available meta-arguments
- Lifecycle rules
- Examples
```

### CLI Flag Reference

```
URL: /terraform/cli/commands/[command]
Example: /terraform/cli/commands/apply

What to extract:
- Command purpose and behavior
- All available flags/options
- Flag descriptions and default values
- Usage examples
- Exit codes
```

## Version Compatibility

Always cross-reference with version requirements:

1. Check `versions.tf` or run `terraform version`
2. Navigate to version-specific upgrade guides if needed
3. Verify feature availability for the detected version
4. Provide version-appropriate examples

## Documentation Not Found?

If a specific topic isn't found at the expected URL:

1. **Check parent section**: Navigate up one level
2. **Try alternate sections**: Language vs CLI, feature may be documented in multiple places
3. **Check Registry**: Provider-specific features may be in provider docs (see `registry.md`)
4. **Check Internals**: Advanced topics often in `/terraform/internals/`

## Keeping Documentation Current

HashiCorp updates documentation continuously. When providing guidance:

- Mention the Terraform version where features were introduced
- Link to relevant documentation URLs for reference
- Note when behavior changed between major versions
- Check upgrade guides for breaking changes
