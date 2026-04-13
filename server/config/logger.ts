// server/config/logger.ts
// Structured logging with PII/PHI redaction for HIPAA compliance
// Destination: stdout → Docker log driver → Grafana Loki (scalable path)
// ──────────────────────────────────────────────────────────────────────
import pino from "pino";

const redactPaths = [
  // PII
  "*.email", "*.phone", "*.full_name", "*.date_of_birth",
  "*.password", "*.token", "*.jwt", "*.appwrite_user_id",
  "req.headers.authorization",
  // PHI
  "*.weight_kg", "*.height_cm", "*.bmi", "*.bmr", "*.tdee",
  "*.health_goal", "*.conditions", "*.allergens", "*.intolerances",
  "*.health_conditions", "*.dietary_preferences",
];

// Custom Logger interface that accepts the console-style calling convention
// used throughout the codebase: logger.error("message", data)
// Pino's strict TS overloads reject this pattern, but it works at runtime.
type LogFn = {
  (msg: string, ...args: unknown[]): void;
  (obj: object, msg?: string, ...args: unknown[]): void;
};

interface Logger {
  fatal: LogFn;
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
  trace: LogFn;
  level: string;
  child(bindings: Record<string, unknown>): Logger;
}

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: redactPaths, remove: true },
  // Pretty-print in dev, JSON in production (stdout → Docker captures it)
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
    : undefined,
}) as unknown as Logger;
