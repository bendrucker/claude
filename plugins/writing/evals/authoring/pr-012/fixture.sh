#!/usr/bin/env bash
set -euo pipefail
git init -q -b master
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/cloudposse/terraform-aws-datadog-integration.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"

cat > versions.tf <<'TF'
terraform {
  required_version = ">= 0.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 3.0"
    }
    datadog = {
      source  = "datadog/datadog"
      version = ">= 3.0"
    }
  }
}
TF

mkdir -p docs
cat > docs/terraform.md <<'MD'
<!-- markdownlint-disable -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 0.13.0 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | >= 3.0 |
| <a name="requirement_datadog"></a> [datadog](#requirement\_datadog) | >= 3.0 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_aws"></a> [aws](#provider\_aws) | >= 3.0 |
| <a name="provider_datadog"></a> [datadog](#provider\_datadog) | >= 3.0 |

## Modules

No modules.
<!-- markdownlint-restore -->
MD

cat > README.md <<'MD'
<!-- markdownlint-disable -->
# terraform-aws-datadog-integration [![Latest Release](https://img.shields.io/github/release/cloudposse/terraform-aws-datadog-integration.svg)](https://github.com/cloudposse/terraform-aws-datadog-integration/releases/latest)
<!-- markdownlint-restore -->

Terraform module to provision the AWS side of a Datadog AWS integration.

## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 0.13.0 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | >= 3.0 |
| <a name="requirement_datadog"></a> [datadog](#requirement\_datadog) | >= 3.0 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_aws"></a> [aws](#provider\_aws) | >= 3.0 |
| <a name="provider_datadog"></a> [datadog](#provider\_datadog) | >= 3.0 |

## Modules

No modules.

[![README Footer][readme_footer_img]][readme_footer_link]
[![Beacon][beacon]][website]

  [readme_footer_img]: https://cloudposse.com/readme/footer/img
  [readme_footer_link]: https://cloudposse.com/readme/footer/link
  [website]: https://cpco.io/homepage
  [beacon]: https://ga-beacon.cloudposse.com/UA-76589703-4/cloudposse/terraform-aws-datadog-integration?pixel
MD

git add -A && git commit -qm "chore: scaffold datadog integration module"
git switch -qc patch-1

# The real PR bumped the pin in versions.tf, then a bot's `terraform-docs` run
# propagated it into the generated README and docs tables.
cat > versions.tf <<'TF'
terraform {
  required_version = ">= 0.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 3.0"
    }
    datadog = {
      source  = "datadog/datadog"
      version = ">= 3.9"
    }
  }
}
TF
git commit -qam "require datadog provider >= 3.9"

cat > docs/terraform.md <<'MD'
<!-- markdownlint-disable -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 0.13.0 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | >= 3.0 |
| <a name="requirement_datadog"></a> [datadog](#requirement\_datadog) | >= 3.9 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_aws"></a> [aws](#provider\_aws) | >= 3.0 |
| <a name="provider_datadog"></a> [datadog](#provider\_datadog) | >= 3.9 |

## Modules

No modules.
<!-- markdownlint-restore -->
MD

cat > README.md <<'MD'
<!-- markdownlint-disable -->
# terraform-aws-datadog-integration [![Latest Release](https://img.shields.io/github/release/cloudposse/terraform-aws-datadog-integration.svg)](https://github.com/cloudposse/terraform-aws-datadog-integration/releases/latest)
<!-- markdownlint-restore -->

Terraform module to provision the AWS side of a Datadog AWS integration.

## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 0.13.0 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | >= 3.0 |
| <a name="requirement_datadog"></a> [datadog](#requirement\_datadog) | >= 3.9 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_aws"></a> [aws](#provider\_aws) | >= 3.0 |
| <a name="provider_datadog"></a> [datadog](#provider\_datadog) | >= 3.9 |

## Modules

No modules.

[![README Footer][readme_footer_img]][readme_footer_link]
[![Beacon][beacon]][website]
<!-- markdownlint-disable -->
  [readme_footer_img]: https://cloudposse.com/readme/footer/img
  [readme_footer_link]: https://cloudposse.com/readme/footer/link
  [website]: https://cpco.io/homepage
  [beacon]: https://ga-beacon.cloudposse.com/UA-76589703-4/cloudposse/terraform-aws-datadog-integration?pixel
<!-- markdownlint-restore -->
MD
git commit -qam "Auto Format"
