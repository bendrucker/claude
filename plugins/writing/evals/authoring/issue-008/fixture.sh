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

mkdir -p cmd internal/forwarder

cat > cmd/forward.go <<'GO'
package cmd

import (
	"context"
	"os"
	"os/signal"

	"github.com/spf13/cobra"
	"github.com/takescoop/kubectl-exec-forward/internal/execforward"
	"github.com/takescoop/kubectl-exec-forward/internal/forwarder"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/tools/clientcmd"
	cmdutil "k8s.io/kubectl/pkg/cmd/util"
)

// newForwardCommand returns the command for forwarding to Kubernetes resources.
func newForwardCommand(streams genericclioptions.IOStreams, version string) *cobra.Command {
	overrides := clientcmd.ConfigOverrides{}

	kubeConfigFlags := genericclioptions.NewConfigFlags(false)

	cmd := &cobra.Command{
		Use:     "kubectl exec-forward TYPE/NAME PORT [options] -- [command...]",
		Short:   "Port forward to Kubernetes resources and execute commands found in annotations",
		Args:    cobra.MinimumNArgs(2),
		Version: version,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			flags := cmd.Flags()

			podTimeout, err := flags.GetDuration("pod-timeout")
			if err != nil {
				return err
			}

			client := forwarder.NewClient(podTimeout, streams)
			if err := client.Init(cmdutil.NewMatchVersionFlags(kubeConfigFlags), overrides, version); err != nil {
				return err
			}

			config := &execforward.Config{
				Command: args[2:],
			}

			cancelCtx, cancel := context.WithCancel(ctx)

			sigChan := make(chan os.Signal, 1)
			signal.Notify(sigChan, os.Interrupt)

			go func() {
				<-sigChan

				cancel()
			}()

			return execforward.Run(cancelCtx, client, config, map[string]string{}, args[0], args[1], streams)
		},
	}

	flags := cmd.Flags()

	flags.DurationP("pod-timeout", "t", 500, "Time to wait for an attachable pod to become available")

	clientcmd.BindOverrideFlags(&overrides, cmd.PersistentFlags(), clientcmd.RecommendedConfigOverrideFlags(""))

	return cmd
}

// Execute executes the forward command.
func Execute(version string) {
	cmd := newForwardCommand(genericclioptions.IOStreams{
		Out:    os.Stdout,
		ErrOut: os.Stderr,
		In:     os.Stdin,
	}, version)

	cobra.CheckErr(cmd.Execute())
}
GO

cat > internal/forwarder/client.go <<'GO'
package forwarder

import (
	"fmt"
	"time"

	"github.com/takescoop/kubectl-exec-forward/internal/attachablepod"
	v1 "k8s.io/api/core/v1"
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

	AttachablePodForObjectFn func(resource string, namespace string, timeout time.Duration) (interface{}, *v1.Pod, error)

	timeout time.Duration
	streams genericclioptions.IOStreams
}

// NewClient returns an uninitialized forwarding client.
func NewClient(timeout time.Duration, streams genericclioptions.IOStreams) *Client {
	return &Client{
		timeout:    timeout,
		streams:    streams,
		clientset:  nil,
		restConfig: nil,
		userConfig: nil,
	}
}

// Init instantiates a Kubernetes client and rest configuration for the forwarding client.
func (c *Client) Init(getter *cmdutil.MatchVersionFlags, overrides clientcmd.ConfigOverrides, version string) error {
	userAgent := fmt.Sprintf("kubectl-exec-forward/%s", version)

	factory := cmdutil.NewFactory(userAgentGetter{
		RESTClientGetter: getter,
		userAgent:        userAgent,
	})

	c.AttachablePodForObjectFn = attachablepod.New(factory).Get

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

cat > internal/forwarder/config.go <<'GO'
package forwarder

import (
	"strconv"

	corev1 "k8s.io/api/core/v1"
)

// Config contains the information required to satisfy a call to Forward.
type Config struct {
	Pod  *corev1.Pod
	Port string
}

// GetLocalPort returns the local ports from the Config port mapping.
func (c Config) GetLocalPort() (port int, err error) {
	localStr, _ := splitPort(c.Port)

	local, err := strconv.ParseInt(localStr, 10, 64)
	if err != nil {
		return 0, err
	}

	return int(local), nil
}

// NewConfig interacts with the Kubernetes API to find a pod and ports suitable for forwarding.
func (c Client) NewConfig(resource string, portMap string) (*Config, error) {
	namespace, _, err := c.userConfig.Namespace()
	if err != nil {
		return nil, err
	}

	obj, pod, err := c.AttachablePodForObjectFn(resource, namespace, c.timeout)
	if err != nil {
		return nil, err
	}

	port, err := c.translatePorts(obj, pod, portMap)
	if err != nil {
		return nil, err
	}

	return &Config{
		Pod:  pod,
		Port: port,
	}, nil
}
GO

git add -A && git commit -qm "Initial state"
