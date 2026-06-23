export function layoutArgs(
  existingPanes: number,
  lastPaneId: string | undefined,
  targetSession?: string,
): string[] {
  if (existingPanes > 0 && lastPaneId) {
    const positionInColumn = existingPanes % 3;
    if (positionInColumn === 0) {
      return ["-h", "-d", "-t", lastPaneId];
    }
    return ["-v", "-d", "-t", lastPaneId];
  }

  // First review pane. With a target session, split that session's active pane
  // and leave it at the default size: the orchestrator lives elsewhere, so
  // there is no local sidebar to carve out. Without one, the orchestrator
  // shares this window, so claim 70% for the review and shrink it to a sidebar.
  if (targetSession) {
    return ["-h", "-d", "-t", targetSession];
  }

  const orchestratorPane = process.env.TMUX_PANE;
  if (!orchestratorPane) {
    throw new Error("TMUX_PANE is not set (not running inside tmux)");
  }
  return ["-h", "-d", "-l", "70%", "-t", orchestratorPane];
}
