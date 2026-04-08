// server/config/logger.ts
// Structured logging with PII/PHI redaction for HIPAA compliance
// Destination: stdout → Docker log driver → Grafana Loki (scalable path)
// ──────────────────────────────────────────────────────────────────────
import pino from "pino";

const redactPaths = [
  // PII
  "*.email", "*.phone", "*.full_name", "*.date_of_birth",
  "*.password", "*.token", "*.jwt", "*.appwrite_user_id",
  // PHI
  "*.weight_kg", "*.height_cm", "*.bmi", "*.bmr", "*.tdee",
  "*.health_goal", "*.conditions", "*.allergens", "*.intolerances",
  "*.health_conditions", "*.dietary_preferences",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: redactPaths, remove: true },
  // Pretty-print in dev, JSON in production (stdout → Docker captures it)
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
    : undefined,
});
