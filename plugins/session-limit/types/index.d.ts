export type SessionLimitAnnounced = Record<string, { band: number; resetsAt: string }>;

declare module "claude-code" {
  interface PluginState {
    "session-limit": { announced: SessionLimitAnnounced };
  }
}
