import type { z } from "zod";
import type { Mux, Runner } from "../../dispatch/scripts/dispatch";
import { CloseError, errorText } from "./errors";
import { present } from "./text";

export type Env = Readonly<Record<string, string | undefined>>;

export type PaneMux = Exclude<Mux, "bg">;

export interface Pane {
  mux: PaneMux;
  target: string;
}

export interface MuxContext {
  env: Env;
  cwd: string;
  run: Runner;
}

export interface Muxer {
  readonly kind: PaneMux;
  // The pane this session runs in.
  ownPane(): string;
  closePane(target: string): Promise<void>;
  // Opens an unfocused pane running `claude attach <fork>` and returns its id.
  openAttachPane(fork: string): Promise<string>;
  // Variables the background continuation needs to reach this pane's session once the pane is gone.
  handoffEnv?: () => Promise<Readonly<Record<string, string>>>;
  // Hides the pane with its process running, and shows it again.
  parkPane?: (target: string) => Promise<void>;
  restorePane?: (target: string) => Promise<void>;
}

export function required(env: Env, name: string): string {
  const value = env[name];
  if (!present(value)) throw new CloseError(`${name} is not set`, 2);
  return value;
}

export function parseOutput<T>(schema: z.ZodType<T>, text: string, label: string): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    throw new CloseError(`${label} returned an unexpected shape: ${errorText(error)}`);
  }
}
