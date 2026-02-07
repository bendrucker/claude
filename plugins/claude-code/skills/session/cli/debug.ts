import { createWriteStream, type WriteStream } from "node:fs";
import type { Tracer } from "@opentelemetry/api";
import otelApi from "@opentelemetry/api";
import otelLogExporter from "@opentelemetry/exporter-logs-otlp-http";
import otelTraceExporter from "@opentelemetry/exporter-trace-otlp-http";
import otelSdkLogs from "@opentelemetry/sdk-logs";
import otelSdkTrace from "@opentelemetry/sdk-trace-base";

const { trace } = otelApi;
const { OTLPLogExporter } = otelLogExporter;
const { OTLPTraceExporter } = otelTraceExporter;
const { LoggerProvider, SimpleLogRecordProcessor } = otelSdkLogs;
const { BasicTracerProvider, SimpleSpanProcessor } = otelSdkTrace;

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

let tracerProvider: InstanceType<typeof BasicTracerProvider> | null = null;
let loggerProvider: InstanceType<typeof LoggerProvider> | null = null;
let fileStream: WriteStream | null = null;

function createSpanExporter(write: (data: unknown) => void): otelSdkTrace.SpanExporter {
  return {
    export(spans, resultCallback) {
      for (const span of spans) {
        const { name, duration, attributes, startTime } = span;
        write({ name, startTime, duration, attributes });
      }
      resultCallback({ code: 0 });
    },
    shutdown: () => Promise.resolve(),
  };
}

function createLogExporter(write: (data: unknown) => void): otelSdkLogs.LogRecordExporter {
  return {
    export(records, resultCallback) {
      for (const record of records) {
        write({ body: record.body, attributes: record.attributes });
      }
      resultCallback({ code: 0 });
    },
    shutdown: () => Promise.resolve(),
  };
}

function writeStderr(data: unknown): void {
  console.error(JSON.stringify(data));
}

function writeJsonl(stream: WriteStream, type: string): (data: unknown) => void {
  return (data) =>
    stream.write(`${JSON.stringify({ type, ...(data as Record<string, unknown>) })}\n`);
}

function addSpanProcessor(exporter: otelSdkTrace.SpanExporter): void {
  tracerProvider?.addSpanProcessor(new SimpleSpanProcessor(exporter));
}

function addLogProcessor(exporter: otelSdkLogs.LogRecordExporter): void {
  loggerProvider?.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter));
}

export function setupTelemetry(options: { logLevel: LogLevel; logFile?: string }): void {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const useOtlp = Boolean(otlpEndpoint);
  const consoleTraces =
    process.env.OTEL_TRACES_EXPORTER === "console" || (!useOtlp && options.logLevel === "trace");
  const consoleLogs = !useOtlp && (options.logLevel === "debug" || options.logLevel === "trace");

  if (options.logFile) {
    fileStream = createWriteStream(options.logFile, { flags: "a" });
    fileStream.on("error", () => {});
  }

  tracerProvider = new BasicTracerProvider();
  loggerProvider = new LoggerProvider();

  if (useOtlp) {
    addSpanProcessor(new OTLPTraceExporter());
    addLogProcessor(new OTLPLogExporter());
  }
  if (consoleTraces) {
    addSpanProcessor(createSpanExporter(writeStderr));
  }
  if (consoleLogs) {
    addLogProcessor(createLogExporter(writeStderr));
  }
  if (fileStream) {
    addSpanProcessor(createSpanExporter(writeJsonl(fileStream, "span")));
    addLogProcessor(createLogExporter(writeJsonl(fileStream, "log")));
  }
}

export async function shutdownTelemetry(): Promise<void> {
  try {
    await Promise.all([tracerProvider?.shutdown(), loggerProvider?.shutdown()]);
  } catch {}
  if (fileStream) {
    await new Promise<void>((resolve) => fileStream?.end(resolve));
    fileStream = null;
  }
}

export function log(message: string): void {
  loggerProvider?.getLogger("session-cli").emit({ body: message });
}

export function tracer(): Tracer {
  return tracerProvider?.getTracer("session-cli") ?? trace.getTracer("session-cli");
}
