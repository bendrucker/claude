#!/usr/bin/env bash
set -euo pipefail
git init -q -b master
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/TakeScoop/kubectl-exec-forward.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"

mkdir -p cmd internal/command internal/forwarder

cat > go.mod <<'GOMOD'
module github.com/takescoop/kubectl-exec-forward

go 1.16

require (
	github.com/pborman/ansi v1.0.0
	github.com/spf13/cobra v1.3.0
	github.com/stretchr/testify v1.7.0
	github.com/ttacon/chalk v0.0.0-20160626202418-22c06c80ed31
	k8s.io/cli-runtime v0.23.1
	k8s.io/client-go v0.23.1
	k8s.io/kubectl v0.23.1
)
GOMOD

cat > cmd/forward.go <<'GO'
package cmd

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/takescoop/kubectl-exec-forward/internal/command"
	"github.com/takescoop/kubectl-exec-forward/internal/forwarder"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/tools/clientcmd"
	cmdutil "k8s.io/kubectl/pkg/cmd/util"
)

// newForwardCommand returns the command for forwarding to Kubernetes resources.
func newForwardCommand(streams *genericclioptions.IOStreams, version string) *cobra.Command {
	overrides := clientcmd.ConfigOverrides{}

	kubeConfigFlags := genericclioptions.NewConfigFlags(false)

	cmd := &cobra.Command{
		Use:     "kubectl exec-forward TYPE/NAME PORT [options] -- [command...]",
		Short:   "Port forward to Kubernetes resources and execute commands found in annotations",
		Args:    cobra.MinimumNArgs(2),
		Version: version,
		RunE: func(cmd *cobra.Command, args []string) error {
			flags := cmd.Flags()

			podTimeout, err := flags.GetDuration("pod-timeout")
			if err != nil {
				return err
			}

			client := forwarder.NewClient(podTimeout, streams)
			if err := client.Init(cmdutil.NewMatchVersionFlags(kubeConfigFlags), overrides, version); err != nil {
				return err
			}

			return command.Run(cmd.Context(), client, &command.Config{Command: args[2:]}, map[string]string{}, args[0], args[1], streams)
		},
	}

	flags := cmd.Flags()

	flags.DurationP("pod-timeout", "t", 500, "Time to wait for an attachable pod to become available")

	clientcmd.BindOverrideFlags(&overrides, cmd.PersistentFlags(), clientcmd.RecommendedConfigOverrideFlags(""))

	return cmd
}

// Execute executes the forward command.
func Execute(version string) {
	cmd := newForwardCommand(&genericclioptions.IOStreams{
		Out:    os.Stdout,
		ErrOut: os.Stderr,
		In:     os.Stdin,
	}, version)

	cobra.CheckErr(cmd.Execute())
}
GO

cat > cmd/forward_test.go <<'GO'
package cmd

import (
	"bytes"
	"sync"
	"testing"

	"k8s.io/cli-runtime/pkg/genericclioptions"
)

type SafeBuffer struct {
	mutex sync.RWMutex
	buf   bytes.Buffer
}

func (b *SafeBuffer) Write(bs []byte) (int, error) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	return b.buf.Write(bs)
}

func (b *SafeBuffer) String() string {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	return b.buf.String()
}

func TestRunForwardCommand(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}

	out := &SafeBuffer{}
	outErr := &SafeBuffer{}

	cmd := newForwardCommand(&genericclioptions.IOStreams{
		Out:    out,
		ErrOut: outErr,
	}, "0.0.0")

	_ = cmd
}
GO

cat > internal/command/command.go <<'GO'
package command

import (
	"context"

	"k8s.io/cli-runtime/pkg/genericclioptions"
)

// Command represents a runnable command.
type Command struct {
	ID          string   `json:"id"`
	Command     []string `json:"command"`
	Interactive bool     `json:"interactive"`
	DisplayName string   `json:"name"`
}

// TemplateData is the data passed to command templates to render the command arguments.
type TemplateData struct {
	LocalPort int
	Args      Args
	Outputs   map[string]string
}

// Execute runs the command with the given config and outputs.
func (c Command) Execute(ctx context.Context, config *Config, args Args, outputs Outputs, streams *genericclioptions.IOStreams) ([]byte, error) {
	data := TemplateData{
		LocalPort: config.LocalPort,
		Args:      args,
		Outputs:   outputs,
	}

	_ = data

	return nil, nil
}
GO

cat > internal/command/command_test.go <<'GO'
package command

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"k8s.io/cli-runtime/pkg/genericclioptions"
)

func TestCommandExecute(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		config  Config
		args    Args
		outputs Outputs
		command Command
		stdin   string
		output  string
		error   bool
	}{
		{
			name:    "no id",
			command: Command{Command: []string{"echo", "hello"}},
			output:  "hello\n",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			streams, stdin, _, _ := genericclioptions.NewTestIOStreams()

			if tc.stdin != "" {
				stdin.Write([]byte(tc.stdin))
			}

			output, err := tc.command.Execute(context.Background(), &tc.config, tc.args, tc.outputs, &streams)

			if tc.error {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}

			assert.Equal(t, tc.output, string(output))
		})
	}
}
GO

cat > internal/command/commands.go <<'GO'
package command

import (
	"context"
	"encoding/json"

	"k8s.io/cli-runtime/pkg/genericclioptions"
)

// Commands stores a slice of commands and provides some helper execution methods.
type Commands []*Command

// Execute runs each command in the calling slice sequentially using the passed config and the outputs accumulated to that point.
func (c Commands) Execute(ctx context.Context, config *Config, args Args, outputs Outputs, streams *genericclioptions.IOStreams) (Outputs, error) {
	for _, command := range c {
		output, err := command.Execute(ctx, config, args, outputs, streams)
		if err != nil {
			return nil, err
		}

		if command.ID != "" {
			outputs = outputs.Append(command.ID, string(output))
		}
	}

	return outputs, nil
}

// parseCommands returns a slice of commands parsed from an annotations map at the value "key".
func parseCommands(annotations map[string]string, key string) (commands Commands, err error) {
	v, ok := annotations[key]
	if !ok {
		return commands, nil
	}

	if err := json.Unmarshal([]byte(v), &commands); err != nil {
		return nil, err
	}

	return commands, err
}
GO

cat > internal/command/commands_test.go <<'GO'
package command

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"k8s.io/cli-runtime/pkg/genericclioptions"
)

func TestCommandsExecute(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		commands Commands
		outputs  Outputs
		expected Outputs
		error    bool
	}{
		{
			name: "with outputs",
			commands: Commands{
				&Command{
					ID:      "foo",
					Command: []string{"echo", "hello"},
				},
			},
			expected: Outputs{"foo": "hello\n"},
		},
	}

	for _, tc := range cases {
		tc := tc

		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			streams := genericclioptions.NewTestIOStreamsDiscard()

			outputs, err := tc.commands.Execute(context.Background(), &Config{}, Args{}, tc.outputs, &streams)

			if tc.error {
				assert.Error(t, err)

				return
			}

			assert.Equal(t, tc.expected, outputs)
		})
	}
}
GO

cat > internal/command/run.go <<'GO'
package command

import (
	"context"

	"github.com/takescoop/kubectl-exec-forward/internal/forwarder"
	"k8s.io/cli-runtime/pkg/genericclioptions"
)

const (
	// PreAnnotation is the annotation key name used to store commands run before establishing a portforward connection.
	PreAnnotation string = "exec-forward.pod.kubernetes.io/pre-connect"
	// PostAnnotation is the annotation key name used to store commands run after establishing a portforward connection.
	PostAnnotation string = "exec-forward.pod.kubernetes.io/post-connect"
	// CommandAnnotation is the annotation key name used to store the main command to run after the post-connect hook has been run.
	CommandAnnotation string = "exec-forward.pod.kubernetes.io/command"
)

// Run executes hooks found on the passed resource's underlying pod annotations and opens a forwarding connection to the resource.
func Run(ctx context.Context, client *forwarder.Client, hooksConfig *Config, cliArgs map[string]string, resource string, portMap string, streams *genericclioptions.IOStreams) error {
	fwdConfig, err := client.NewConfig(resource, portMap)
	if err != nil {
		return err
	}

	localPort, err := fwdConfig.GetLocalPort()
	if err != nil {
		return err
	}

	hooksConfig.LocalPort = localPort

	return nil
}
GO

cat > internal/forwarder/client.go <<'GO'
package forwarder

import (
	"fmt"
	"time"

	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	cmdutil "k8s.io/kubectl/pkg/cmd/util"
)

// Client interfaces with Kubernetes to facilitate a port-forwarding tunnel as well as fetch information about the forwarding target.
type Client struct {
	clientset  *kubernetes.Clientset
	restConfig *rest.Config
	userConfig clientcmd.ClientConfig
	factory    cmdutil.Factory
	timeout    time.Duration
	streams    *genericclioptions.IOStreams
}

// NewClient returns an uninitialized forwarding client.
func NewClient(timeout time.Duration, streams *genericclioptions.IOStreams) *Client {
	return &Client{
		timeout:    timeout,
		streams:    streams,
		clientset:  nil,
		factory:    nil,
		restConfig: nil,
		userConfig: nil,
	}
}

// Init instantiates a Kubernetes client and rest configuration for the forwarding client.
func (c *Client) Init(getter *cmdutil.MatchVersionFlags, overrides clientcmd.ConfigOverrides, version string) error {
	userAgent := fmt.Sprintf("kubectl-exec-forward/%s", version)

	c.factory = cmdutil.NewFactory(restGetter{
		restClientGetter: getter,
		userAgent:        userAgent,
	})

	kc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		clientcmd.NewDefaultClientConfigLoadingRules(),
		&overrides,
	)

	c.userConfig = kc

	rc, err := kc.ClientConfig()
	if err != nil {
		return err
	}

	rc.UserAgent = userAgent

	c.restConfig = rc

	cs, err := kubernetes.NewForConfig(rc)
	if err != nil {
		return err
	}

	c.clientset = cs

	return nil
}
GO

git add -A && git commit -qm "Initial state"
git switch -qc iostreams-val

sed -i '' 's/func newForwardCommand(streams \*genericclioptions.IOStreams, version string)/func newForwardCommand(streams genericclioptions.IOStreams, version string)/' cmd/forward.go
sed -i '' 's/cmd := newForwardCommand(&genericclioptions.IOStreams{/cmd := newForwardCommand(genericclioptions.IOStreams{/' cmd/forward.go
sed -i '' 's/cmd := newForwardCommand(&genericclioptions.IOStreams{/cmd := newForwardCommand(genericclioptions.IOStreams{/' cmd/forward_test.go
sed -i '' 's/streams \*genericclioptions.IOStreams) (\[\]byte, error)/streams genericclioptions.IOStreams) ([]byte, error)/' internal/command/command.go
sed -i '' 's/tc.outputs, &streams)/tc.outputs, streams)/' internal/command/command_test.go
sed -i '' 's/streams \*genericclioptions.IOStreams) (Outputs, error)/streams genericclioptions.IOStreams) (Outputs, error)/' internal/command/commands.go
perl -0777 -pi -e 's/\t\t\tstreams := genericclioptions\.NewTestIOStreamsDiscard\(\)\n\n\t\t\toutputs, err := tc\.commands\.Execute\(context\.Background\(\), &Config\{\}, Args\{\}, tc\.outputs, &streams\)/\t\t\toutputs, err := tc.commands.Execute(context.Background(), &Config{}, Args{}, tc.outputs, genericclioptions.NewTestIOStreamsDiscard())/' internal/command/commands_test.go
sed -i '' 's/streams \*genericclioptions.IOStreams) error {/streams genericclioptions.IOStreams) error {/' internal/command/run.go
sed -i '' 's/streams    \*genericclioptions.IOStreams/streams    genericclioptions.IOStreams/' internal/forwarder/client.go
sed -i '' 's/func NewClient(timeout time.Duration, streams \*genericclioptions.IOStreams) \*Client {/func NewClient(timeout time.Duration, streams genericclioptions.IOStreams) *Client {/' internal/forwarder/client.go

git add -A && git commit -qm "pass \`genericclioptions.IOStreams\` as value"
