/**
 * What a mod passes to `$.modEvents.emit`.
 */
export interface ModEventsInput {
  /** The emitting plugin's name. */
  mod: string;
  /** What happened, dotted: `session.start`, `herdr.call`, `pick`. */
  event: string;
  /** False when what the event records failed. Defaults to true. */
  ok?: boolean;
  /** How long it took, for an event with a duration. */
  ms?: number;
  /** Event-specific fields, as JSON data. */
  detail?: Record<string, unknown>;
}

/**
 * One line of `<config>/mod-events/<session>/<mod>.<instance>.<n>.jsonl`, the
 * shape the session index ingests as `mod_events`.
 */
export interface ModEventsRecord {
  ts: number;
  session: string;
  mod: string;
  event: string;
  ok: boolean;
  ms: number | null;
  detail: Record<string, unknown>;
}

export interface ModEvents {
  /** Records one event. Never rejects, so a caller need not await it. */
  emit: (event: ModEventsInput) => Promise<void>;
}

declare module "claude-code" {
  interface EngineInterface {
    modEvents: ModEvents;
  }
}
