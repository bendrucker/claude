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
 * One line of `<config>/mod-events/<session>/<mod>.<instance>.<n>.jsonl`: an
 * OTel log record with its fields flat, the shape the session index ingests as
 * `mod_events`.
 */
export interface ModEventsRecord {
  /** ISO 8601, as Claude Code's own `event.timestamp`. */
  timestamp: string;
  severity_text: "INFO" | "WARN";
  severity_number: 9 | 13;
  /** `<mod>.<event>`. */
  event_name: string;
  /** The event's detail, plus `duration_ms` and `session.id`. */
  attributes: Record<string, unknown>;
  /** `service.name`, `service.version`, and `claude_code.surface` once known. */
  resource: Record<string, string>;
  scope: { name: string };
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
