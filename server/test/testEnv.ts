/**
 * Set minimal process.env for modules that validate config at import time
 * (e.g. config/env.ts via middleware/rateLimit.ts).
 *
 * Import this as the **first** import in tests that load those modules.
 */
const defaults: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://127.0.0.1:5432/nutrition_test",
  APPWRITE_ENDPOINT: "https://example.com",
  APPWRITE_PROJECT_ID: "test-project-id",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-at-least-32-characters-long",
  RATE_LIMITS_READ_RPM: "60",
  RATE_LIMITS_WRITE_RPM: "6",
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
  }
}
