terraform {
  cloud {
    organization = "bendrucker"

    workspaces {
      name = "claude"
    }
  }
}
