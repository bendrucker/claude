export function layoutArgs(existingPanes: number, lastPaneId: string | undefined): string[] {
  const orchestratorPane = process.env.TMUX_PANE;
  if (!orchestratorPane) {
    throw new Error("TMUX_PANE is not set (not running inside tmux)");
  }

  if (existingPanes === 0 || !lastPaneId) {
    return ["-h", "-d", "-l", "70%", "-t", orchestratorPane];
  }

  const positionInColumn = existingPanes % 3;
  if (positionInColumn === 0) {
    return ["-h", "-d", "-t", lastPaneId];
  }

  return ["-v", "-d", "-t", lastPaneId];
}
