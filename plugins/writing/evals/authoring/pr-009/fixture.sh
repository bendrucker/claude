#!/usr/bin/env bash
set -euo pipefail
git init -q -b master
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/brainly/terraform-provider-redshift.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > go.mod <<'MOD'
module github.com/brainly/terraform-provider-redshift

go 1.17
MOD
mkdir -p redshift
cat > redshift/resource_redshift_user.go <<'GO'
package redshift

import (
	"context"
	"crypto/md5"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/validation"
	"github.com/lib/pq"
)

const (
	userNameAttr         = "name"
	userPasswordAttr     = "password"
	userValidUntilAttr   = "valid_until"
	userCreateDBAttr     = "create_database"
	userConnLimitAttr    = "connection_limit"
	userSyslogAccessAttr = "syslog_access"
	userSuperuserAttr    = "superuser"

	// defaults
	defaultUserSyslogAccess          = "RESTRICTED"
	defaultUserSuperuserSyslogAccess = "UNRESTRICTED"
)

// When authenticating using temporary credentials obtained by GetClusterCredentials,
// the resulting username is prefixed with either "IAM:"" or "IAMA:"
// This regexp is designed to match either prefix.
// See https://docs.aws.amazon.com/redshift/latest/APIReference/API_GetClusterCredentials.html
var temporaryCredentialsUsernamePrefixRegexp = regexp.MustCompile("^(?:IAMA?:)")

// Resolve the "real" username by stripping the temporary credentials prefix
func permanentUsername(username string) string {
	return temporaryCredentialsUsernamePrefixRegexp.ReplaceAllString(username, "")
}

func redshiftUser() *schema.Resource {
	return &schema.Resource{
		Description: `
Amazon Redshift user accounts can only be created and dropped by a database superuser. Users are authenticated when they login to Amazon Redshift. They can own databases and database objects (for example, tables) and can grant privileges on those objects to users, groups, and schemas to control who has access to which object. Users with CREATE DATABASE rights can create databases and grant privileges to those databases. Superusers have database ownership privileges for all databases.
`,
		Create: RedshiftResourceFunc(resourceRedshiftUserCreate),
		Read:   RedshiftResourceFunc(resourceRedshiftUserRead),
		Update: RedshiftResourceFunc(resourceRedshiftUserUpdate),
		Delete: RedshiftResourceFunc(
			RedshiftResourceRetryOnPQErrors(resourceRedshiftUserDelete),
		),
		Exists: RedshiftResourceExistsFunc(resourceRedshiftUserExists),
		Importer: &schema.ResourceImporter{
			State: schema.ImportStatePassthrough,
		},
		CustomizeDiff: func(_ context.Context, d *schema.ResourceDiff, p interface{}) error {
			isSuperuser := d.Get(userSuperuserAttr).(bool)
			password, hasPassword := d.GetOk(userPasswordAttr)
			if isSuperuser && (!hasPassword || password.(string) == "") {
				return fmt.Errorf("Users that are superusers must define a password.")
			}

			return nil
		},

		Schema: map[string]*schema.Schema{
			userNameAttr: {
				Type:        schema.TypeString,
				Required:    true,
				Description: "The name of the user account to create. The user name can't be `PUBLIC`.",
				ValidateFunc: validation.StringNotInSlice([]string{
					"public",
				}, true),
				StateFunc: func(val interface{}) string {
					return strings.ToLower(val.(string))
				},
			},
			userPasswordAttr: {
				Type:        schema.TypeString,
				Optional:    true,
				Sensitive:   true,
				Description: "Sets the user's password. Users can change their own passwords, unless the password is disabled. To disable password, omit this parameter or set it to `null`.",
			},
			userValidUntilAttr: {
				Type:        schema.TypeString,
				Optional:    true,
				Default:     "infinity",
				Description: "Sets a date and time after which the user's password is no longer valid. By default the password has no time limit.",
			},
		},
	}
}
GO
cat > redshift/resource_redshift_user_test.go <<'GO'
package redshift

import (
	"database/sql"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/acctest"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/hashicorp/terraform-plugin-sdk/v2/terraform"
)

func TestAccRedshiftUser_SuperuserFalseDoesntRequiresPassword(t *testing.T) {
	userName := strings.ReplaceAll(acctest.RandomWithPrefix("tf_acc_superuser"), "-", "_")
	config := fmt.Sprintf(`
resource "redshift_user" "superuser" {
  name = %[1]q
  superuser = false
}
`, userName)

	resource.Test(t, resource.TestCase{
		PreCheck:     func() { testAccPreCheck(t) },
		Providers:    testAccProviders,
		CheckDestroy: testAccCheckRedshiftUserDestroy,
		Steps: []resource.TestStep{
			{
				Config: config,
			},
		},
	})
}

func testAccCheckRedshiftUserDestroy(s *terraform.State) error {
	client := testAccProvider.Meta().(*Client)

	for _, rs := range s.RootModule().Resources {
		if rs.Type != "redshift_user" {
			continue
		}

		exists, err := checkUserExists(client, rs.Primary.ID)

		if err != nil {
			return fmt.Errorf("Error checking role %s", err)
		}

		if exists {
			return fmt.Errorf("User still exists after destroy")
		}
	}

	return nil
}
GO
git add -A && git commit -qm "redshift: initial user resource"
git switch -qc superuser-password-unknown
cat > redshift/resource_redshift_user.go <<'GO'
package redshift

import (
	"context"
	"crypto/md5"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/validation"
	"github.com/lib/pq"
)

const (
	userNameAttr         = "name"
	userPasswordAttr     = "password"
	userValidUntilAttr   = "valid_until"
	userCreateDBAttr     = "create_database"
	userConnLimitAttr    = "connection_limit"
	userSyslogAccessAttr = "syslog_access"
	userSuperuserAttr    = "superuser"

	// defaults
	defaultUserSyslogAccess          = "RESTRICTED"
	defaultUserSuperuserSyslogAccess = "UNRESTRICTED"
)

// When authenticating using temporary credentials obtained by GetClusterCredentials,
// the resulting username is prefixed with either "IAM:"" or "IAMA:"
// This regexp is designed to match either prefix.
// See https://docs.aws.amazon.com/redshift/latest/APIReference/API_GetClusterCredentials.html
var temporaryCredentialsUsernamePrefixRegexp = regexp.MustCompile("^(?:IAMA?:)")

// Resolve the "real" username by stripping the temporary credentials prefix
func permanentUsername(username string) string {
	return temporaryCredentialsUsernamePrefixRegexp.ReplaceAllString(username, "")
}

func redshiftUser() *schema.Resource {
	return &schema.Resource{
		Description: `
Amazon Redshift user accounts can only be created and dropped by a database superuser. Users are authenticated when they login to Amazon Redshift. They can own databases and database objects (for example, tables) and can grant privileges on those objects to users, groups, and schemas to control who has access to which object. Users with CREATE DATABASE rights can create databases and grant privileges to those databases. Superusers have database ownership privileges for all databases.
`,
		Create: RedshiftResourceFunc(resourceRedshiftUserCreate),
		Read:   RedshiftResourceFunc(resourceRedshiftUserRead),
		Update: RedshiftResourceFunc(resourceRedshiftUserUpdate),
		Delete: RedshiftResourceFunc(
			RedshiftResourceRetryOnPQErrors(resourceRedshiftUserDelete),
		),
		Exists: RedshiftResourceExistsFunc(resourceRedshiftUserExists),
		Importer: &schema.ResourceImporter{
			State: schema.ImportStatePassthrough,
		},
		CustomizeDiff: func(_ context.Context, d *schema.ResourceDiff, p interface{}) error {
			isSuperuser := d.Get(userSuperuserAttr).(bool)
			isPasswordKnown := d.NewValueKnown(userPasswordAttr)

			password, hasPassword := d.GetOk(userPasswordAttr)
			if isSuperuser && isPasswordKnown && (!hasPassword || password.(string) == "") {
				return fmt.Errorf("Users that are superusers must define a password.")
			}

			return nil
		},

		Schema: map[string]*schema.Schema{
			userNameAttr: {
				Type:        schema.TypeString,
				Required:    true,
				Description: "The name of the user account to create. The user name can't be `PUBLIC`.",
				ValidateFunc: validation.StringNotInSlice([]string{
					"public",
				}, true),
				StateFunc: func(val interface{}) string {
					return strings.ToLower(val.(string))
				},
			},
			userPasswordAttr: {
				Type:        schema.TypeString,
				Optional:    true,
				Sensitive:   true,
				Description: "Sets the user's password. Users can change their own passwords, unless the password is disabled. To disable password, omit this parameter or set it to `null`.",
			},
			userValidUntilAttr: {
				Type:        schema.TypeString,
				Optional:    true,
				Default:     "infinity",
				Description: "Sets a date and time after which the user's password is no longer valid. By default the password has no time limit.",
			},
		},
	}
}
GO
cat > redshift/resource_redshift_user_test.go <<'GO'
package redshift

import (
	"database/sql"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/acctest"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/hashicorp/terraform-plugin-sdk/v2/terraform"
)

func TestAccRedshiftUser_SuperuserFalseDoesntRequiresPassword(t *testing.T) {
	userName := strings.ReplaceAll(acctest.RandomWithPrefix("tf_acc_superuser"), "-", "_")
	config := fmt.Sprintf(`
resource "redshift_user" "superuser" {
  name = %[1]q
  superuser = false
}
`, userName)

	resource.Test(t, resource.TestCase{
		PreCheck:     func() { testAccPreCheck(t) },
		Providers:    testAccProviders,
		CheckDestroy: testAccCheckRedshiftUserDestroy,
		Steps: []resource.TestStep{
			{
				Config: config,
			},
		},
	})
}

func TestAccRedshiftUser_SuperuserUnknownPassword(t *testing.T) {
	userName := strings.ReplaceAll(acctest.RandomWithPrefix("tf_acc_superuser"), "-", "_")
	config := fmt.Sprintf(`
resource "redshift_user" "superuser" {
  name = %[1]q
  superuser = true
	password  = unknown_string.password.result
}

resource "unknown_string" "password" {}
`, userName)

	// unknownProvider is a mock provider that generates computed values that are unknown at plan time
	// It simulates the behavior of the `random_password` resource
	unknownProvider := &schema.Provider{
		Schema: map[string]*schema.Schema{},
		ResourcesMap: map[string]*schema.Resource{
			"unknown_string": {
				Schema: map[string]*schema.Schema{
					"result": {
						Type:     schema.TypeString,
						Computed: true,
					},
				},
				Create: func(d *schema.ResourceData, meta interface{}) error {
					d.SetId("test")
					d.Set("result", "TestPassword123")
					return nil
				},
				Read: func(d *schema.ResourceData, meta interface{}) error {
					return nil
				},
				Delete: func(d *schema.ResourceData, meta interface{}) error {
					return nil
				},
			},
		},
	}

	providers := map[string]*schema.Provider{
		"unknown":  unknownProvider,
		"redshift": testAccProvider,
	}

	resource.Test(t, resource.TestCase{
		PreCheck:     func() { testAccPreCheck(t) },
		Providers:    providers,
		CheckDestroy: testAccCheckRedshiftUserDestroy,
		Steps: []resource.TestStep{
			{
				Config: config,
			},
		},
	})
}

func testAccCheckRedshiftUserDestroy(s *terraform.State) error {
	client := testAccProvider.Meta().(*Client)

	for _, rs := range s.RootModule().Resources {
		if rs.Type != "redshift_user" {
			continue
		}

		exists, err := checkUserExists(client, rs.Primary.ID)

		if err != nil {
			return fmt.Errorf("Error checking role %s", err)
		}

		if exists {
			return fmt.Errorf("User still exists after destroy")
		}
	}

	return nil
}
GO
git commit -qam "\`user\`: handle unknown superuser passwords"
