import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export function configPath(): string {
  return process.env.CHIEF_CONFIG ?? join(homedir(), ".config", "chief", "config.json");
}
const DEFAULT_BASE_URL = "http://127.0.0.1:7391";
const PROBE_TIMEOUT_MS = 1500;

const BarkConfigSchema = z.object({
  url: z.string(),
  devices: z.array(z.string()),
  key: z.string(),
  actUrl: z.string(),
});

const ConfigSchema = z.object({
  bark: BarkConfigSchema.optional(),
  herdr: z.object({ agent: z.string() }),
  presence: z.object({
    focusFile: z.string(),
    calendar: z.boolean(),
    workHours: z.tuple([z.string(), z.string()]),
  }),
  grace: z.object({ permission: z.string(), idle: z.string() }),
});
export type Config = z.infer<typeof ConfigSchema>;

const HerdrAgentSchema = z.looseObject({
  agent: z.string().optional(),
  pane: z.string().optional(),
});
const HerdrAgentListSchema = z.object({ agents: z.array(HerdrAgentSchema) });
const HerdrListResponseSchema = z.union([
  HerdrAgentListSchema,
  z.object({ result: HerdrAgentListSchema }),
]);
export type HerdrAgentListLike = z.infer<typeof HerdrAgentListSchema>;

export async function herdrListAgents(): Promise<HerdrAgentListLike> {
  const proc = Bun.spawn(["herdr", "agent", "list"], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const parsed = HerdrListResponseSchema.parse(JSON.parse(output));
  return "result" in parsed ? parsed.result : parsed;
}

function expandHome(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

function pass(name: string): DoctorCheck {
  return { name, status: "pass" };
}

function fail(name: string, detail: string): DoctorCheck {
  return { name, status: "fail", detail };
}

function skip(name: string, detail: string): DoctorCheck {
  return { name, status: "skip", detail };
}

async function probeHealthz(
  name: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<DoctorCheck> {
  try {
    const response = await fetchImpl(`${baseUrl}/healthz`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok ? pass(name) : fail(name, `HTTP ${response.status}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : String(error));
  }
}

export async function checkHealthz(baseUrl: string, fetchImpl: typeof fetch): Promise<DoctorCheck> {
  return probeHealthz("daemon healthz", baseUrl, fetchImpl);
}

export interface ConfigCheckResult {
  check: DoctorCheck;
  config?: Config;
}

export async function checkConfig(path: string): Promise<ConfigCheckResult> {
  const name = "config parses";
  const file = Bun.file(path);
  if (!(await file.exists())) return { check: fail(name, `missing: ${path}`) };

  try {
    const config = ConfigSchema.parse(JSON.parse(await file.text()));
    return { check: pass(name), config };
  } catch (error) {
    return { check: fail(name, error instanceof Error ? error.message : String(error)) };
  }
}

export async function checkBarkServer(
  config: Config | undefined,
  fetchImpl: typeof fetch,
): Promise<DoctorCheck> {
  const name = "bark server reachable";
  if (!config?.bark) return skip(name, "no bark block in config");
  return probeHealthz(name, config.bark.url, fetchImpl);
}

export function checkBarkDevices(config: Config | undefined): DoctorCheck {
  const count = config?.bark?.devices.length ?? 0;
  const name = `bark devices set (${count})`;
  if (!config?.bark) return skip(name, "no bark block in config");
  return count > 0 ? pass(name) : fail(name, "no device keys configured");
}

function actPort(): number {
  return process.env.CHIEF_ACT_PORT !== undefined ? Number(process.env.CHIEF_ACT_PORT) : 7392;
}

export function defaultActBaseUrl(): string {
  return `http://127.0.0.1:${actPort()}`;
}

export async function checkActListening(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<DoctorCheck> {
  return probeHealthz("act page listening", baseUrl, fetchImpl);
}

export async function checkActReachable(
  config: Config | undefined,
  fetchImpl: typeof fetch,
): Promise<DoctorCheck> {
  const name = "act page reachable on tailnet";
  if (!config?.bark) return skip(name, "no bark block in config");

  try {
    const response = await fetchImpl(`${config.bark.actUrl}/healthz`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok ? pass(name) : skip(name, `HTTP ${response.status}`);
  } catch (error) {
    return skip(name, error instanceof Error ? error.message : String(error));
  }
}

export async function checkHerdrAgent(
  config: Config | undefined,
  listAgents: () => Promise<HerdrAgentListLike>,
): Promise<DoctorCheck> {
  const name = "herdr agent list";
  if (!config) return skip(name, "config unavailable");

  try {
    const { agents } = await listAgents();
    const found = agents.some((agent) => agent.agent === config.herdr.agent);
    return found ? pass(name) : fail(name, `no agent named ${config.herdr.agent}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : String(error));
  }
}

export async function checkFocusFile(config: Config | undefined): Promise<DoctorCheck> {
  const name = "Focus file readable";
  if (!config) return skip(name, "config unavailable");

  const path = expandHome(config.presence.focusFile);
  return (await Bun.file(path).exists()) ? pass(name) : fail(name, path);
}

export interface DoctorDeps {
  baseUrl?: string;
  actBaseUrl?: string;
  configPath?: string;
  fetchImpl?: typeof fetch;
  listAgents?: () => Promise<HerdrAgentListLike>;
}

export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorCheck[]> {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const actBaseUrl = deps.actBaseUrl ?? defaultActBaseUrl();
  const resolvedConfigPath = deps.configPath ?? configPath();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const listAgents = deps.listAgents ?? herdrListAgents;

  const { check: configCheck, config } = await checkConfig(resolvedConfigPath);

  return [
    await checkHealthz(baseUrl, fetchImpl),
    configCheck,
    await checkBarkServer(config, fetchImpl),
    checkBarkDevices(config),
    await checkActListening(actBaseUrl, fetchImpl),
    await checkActReachable(config, fetchImpl),
    await checkHerdrAgent(config, listAgents),
    await checkFocusFile(config),
  ];
}

export function formatCheck(check: DoctorCheck): string {
  const detail = check.detail !== undefined ? ` (${check.detail})` : "";
  return `${check.status} - ${check.name}${detail}`;
}
