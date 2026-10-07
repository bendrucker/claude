#!/usr/bin/env bash
set -euo pipefail
git init -q -b master
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/PagerDuty/terraform-provider-pagerduty.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
mkdir -p pagerduty
cat > pagerduty/resource_pagerduty_slack_connection.go <<'GO'
package pagerduty

import (
	"log"
	"net/http"
	"time"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func resourcePagerDutySlackConnectionCreate(d *schema.ResourceData, meta interface{}) error {
	client, err := meta.(*Config).SlackClient()
	if err != nil {
		return err
	}

	retryErr := resource.Retry(2*time.Minute, func() *resource.RetryError {

		slackConn, err := buildSlackConnectionStruct(d)
		if err != nil {
			return resource.NonRetryableError(err)
		}
		log.Printf("[INFO] Creating PagerDuty slack connection for source %s and slack channel %s", slackConn.SourceID, slackConn.ChannelID)

		if slackConn, _, err = client.SlackConnections.Create(slackConn.WorkspaceID, slackConn); err != nil {
			return resource.RetryableError(err)
		} else if slackConn != nil {
			d.SetId(slackConn.ID)
			d.Set("workspace_id", slackConn.WorkspaceID)
		}
		return nil
	})
	if retryErr != nil {
		time.Sleep(2 * time.Second)
		return retryErr
	}
	return resourcePagerDutySlackConnectionRead(d, meta)
}

func resourcePagerDutySlackConnectionRead(d *schema.ResourceData, meta interface{}) error {
	client, err := meta.(*Config).SlackClient()
	if err != nil {
		return err
	}

	log.Printf("[INFO] Reading PagerDuty slack connection %s", d.Id())

	workspaceID := d.Get("workspace_id").(string)
	log.Printf("[DEBUG] Read Slack Connection: workspace_id %s", workspaceID)

	retryErr := resource.Retry(2*time.Minute, func() *resource.RetryError {
		if slackConn, _, err := client.SlackConnections.Get(workspaceID, d.Id()); err != nil {
			if isErrCode(err, http.StatusBadRequest) {
				return resource.NonRetryableError(err)
			}

			return resource.RetryableError(err)
		} else if slackConn != nil {
			d.Set("source_id", slackConn.SourceID)
			d.Set("source_name", slackConn.SourceName)
			d.Set("source_type", slackConn.SourceType)
			d.Set("channel_id", slackConn.ChannelID)
			d.Set("channel_name", slackConn.ChannelName)
			d.Set("notification_type", slackConn.NotificationType)
			d.Set("config", flattenConnectionConfig(slackConn.Config))
		}
		return nil
	})

	if retryErr != nil {
		time.Sleep(2 * time.Second)
		return retryErr
	}

	return nil
}
GO
git add -A && git commit -qm "Initial state"
git switch -qc slack-handle-404
cat > pagerduty/resource_pagerduty_slack_connection.go <<'GO'
package pagerduty

import (
	"log"
	"net/http"
	"time"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func resourcePagerDutySlackConnectionCreate(d *schema.ResourceData, meta interface{}) error {
	client, err := meta.(*Config).SlackClient()
	if err != nil {
		return err
	}

	retryErr := resource.Retry(2*time.Minute, func() *resource.RetryError {

		slackConn, err := buildSlackConnectionStruct(d)
		if err != nil {
			return resource.NonRetryableError(err)
		}
		log.Printf("[INFO] Creating PagerDuty slack connection for source %s and slack channel %s", slackConn.SourceID, slackConn.ChannelID)

		if slackConn, _, err = client.SlackConnections.Create(slackConn.WorkspaceID, slackConn); err != nil {
			return resource.RetryableError(err)
		} else if slackConn != nil {
			d.SetId(slackConn.ID)
			d.Set("workspace_id", slackConn.WorkspaceID)
		}
		return nil
	})
	if retryErr != nil {
		time.Sleep(2 * time.Second)
		return retryErr
	}
	return resourcePagerDutySlackConnectionRead(d, meta)
}

func resourcePagerDutySlackConnectionRead(d *schema.ResourceData, meta interface{}) error {
	return fetchSlackConnection(d, meta, handleNotFoundError)
}

func fetchSlackConnection(d *schema.ResourceData, meta interface{}, errCallback func(error, *schema.ResourceData) error) error {
	client, err := meta.(*Config).SlackClient()
	if err != nil {
		return err
	}

	log.Printf("[INFO] Reading PagerDuty slack connection %s", d.Id())

	workspaceID := d.Get("workspace_id").(string)
	log.Printf("[DEBUG] Read Slack Connection: workspace_id %s", workspaceID)

	retryErr := resource.Retry(2*time.Minute, func() *resource.RetryError {
		if slackConn, _, err := client.SlackConnections.Get(workspaceID, d.Id()); err != nil {
			if isErrCode(err, http.StatusBadRequest) {
				return resource.NonRetryableError(err)
			}

      errResp := errCallback(err, d)
      if errResp != nil {
        return resource.RetryableError(err)
      }
      return nil
		} else if slackConn != nil {
			d.Set("source_id", slackConn.SourceID)
			d.Set("source_name", slackConn.SourceName)
			d.Set("source_type", slackConn.SourceType)
			d.Set("channel_id", slackConn.ChannelID)
			d.Set("channel_name", slackConn.ChannelName)
			d.Set("notification_type", slackConn.NotificationType)
			d.Set("config", flattenConnectionConfig(slackConn.Config))
		}

		return nil
	})
}
GO
git commit -qam "\`slack_connection\`: remove state on 404"
