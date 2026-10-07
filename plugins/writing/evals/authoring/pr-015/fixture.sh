#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/hashicorp/go-plugin.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
cat > go.mod <<'MOD'
module github.com/hashicorp/go-plugin

go 1.17
MOD
cat > client.go <<'GO'
package plugin

import (
	"fmt"
	"strconv"
)

// checkProtoVersion returns the negotiated version and PluginSet.
// This returns an error if the server returned an incompatible protocol
// version, or an invalid handshake response.
func (c *Client) checkProtoVersion(protoVersion string) (int, PluginSet, error) {
	serverVersion, err := strconv.Atoi(protoVersion)
	if err != nil {
		return 0, nil, fmt.Errorf("Error parsing protocol version %q: %s", protoVersion, err)
	}

	// record these for the error message
	var clientVersions []int

	// all versions, including the legacy ProtocolVersion have been added to
	// the versions set
	for version, plugins := range c.config.VersionedPlugins {
		clientVersions = append(clientVersions, version)

		if serverVersion != version {
			continue
		}
		return version, plugins, nil
	}

	return 0, nil, fmt.Errorf("Incompatible API version with plugin. "+
		"Plugin version: %d, Client versions: %d", serverVersion, clientVersions)
}
GO
cat > client_test.go <<'GO'
package plugin

import (
	"fmt"
	"testing"
	"time"
)

func TestClientStart_badNegotiatedVersion(t *testing.T) {
	config := &ClientConfig{
		Cmd:          helperProcess("test-versioned-plugins"),
		StartTimeout: 50 * time.Millisecond,
		// test-versioned-plugins only has version 2
		HandshakeConfig: testHandshake,
		Plugins:         testPluginMap,
	}

	c := NewClient(config)
	defer c.Kill()

	_, err := c.Start()
	if err == nil {
		t.Fatal("err should not be nil")
	}
	fmt.Println(err)
}
GO
git add -A && git commit -qm "checkProtoVersion: wrap version mismatch in a plain error"
git switch -qc protocol-version-error
cat > client.go <<'GO'
package plugin

import (
	"fmt"
	"strconv"
)

// checkProtoVersion returns the negotiated version and PluginSet.
// This returns an error if the server returned an incompatible protocol
// version, or an invalid handshake response.
func (c *Client) checkProtoVersion(protoVersion string) (int, PluginSet, error) {
	serverVersion, err := strconv.Atoi(protoVersion)
	if err != nil {
		return 0, nil, fmt.Errorf("Error parsing protocol version %q: %s", protoVersion, err)
	}

	// record these for the error message
	var clientVersions []int

	// all versions, including the legacy ProtocolVersion have been added to
	// the versions set
	for version, plugins := range c.config.VersionedPlugins {
		clientVersions = append(clientVersions, version)

		if serverVersion != version {
			continue
		}
		return version, plugins, nil
	}

	return 0, nil, &ProtocolVersionError{
		ClientVersions: clientVersions,
		ServerVersion:  serverVersion,
	}
}

type ProtocolVersionError struct {
	ClientVersions []int
	ServerVersion  int
}

func (e *ProtocolVersionError) Error() string {
	return fmt.Sprintf("Incompatible API version with plugin. "+
		"Plugin version: %d, Client versions: %d", e.ServerVersion, e.ClientVersions)
}
GO
cat > client_test.go <<'GO'
package plugin

import (
	"fmt"
	"testing"
	"time"
)

func TestClientStart_badNegotiatedVersion(t *testing.T) {
	config := &ClientConfig{
		Cmd:          helperProcess("test-versioned-plugins"),
		StartTimeout: 50 * time.Millisecond,
		// test-versioned-plugins only has version 2
		HandshakeConfig: testHandshake,
		Plugins:         testPluginMap,
	}

	c := NewClient(config)
	defer c.Kill()

	_, err := c.Start()
	if err == nil {
		t.Fatal("err should not be nil")
	}
	fmt.Println(err)

	versionErr, ok := err.(*ProtocolVersionError)
	if !ok {
		t.Fatal("err should be a ProtocolVersionError")
	}

	if versionErr.ServerVersion != 2 {
		t.Fatalf("expected server version 2, got: %d", versionErr.ServerVersion)
	}
}
GO
git commit -qam "add ProtocolVersionError type with client/server versions"
