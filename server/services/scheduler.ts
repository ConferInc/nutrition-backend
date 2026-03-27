// B2C-001: Notification scheduling via in-process cron
// Replaces the per-request trigger model with 2×/day batch processing.
import cron from "node-cron";
import { executeRaw } from "../config/database.js";
import { ragNotifications } from "./ragClient.js";

const CRON_ENABLED = process.env.NOTIFICATION_CRON_ENABLED === "true";
const MORNING_SCHEDULE = process.env.NOTIFICATION_CRON_MORNING ?? "0 8 * * *";
const EVENING_SCHEDULE = process.env.NOTIFICATION_CRON_EVENING ?? "0 18 * * *";
const BATCH_SIZE = parseInt(process.env.NOTIFICATION_CRON_BATCH_SIZE ?? "100", 10);

async function runNotificationBatch(): Promise<void> {
  const startMs = Date.now();
  console.log(`[scheduler] Notification batch starting...`);

  try {
    // Fetch active customers who have used the platform recently (last 7 days)
    const customers = (await executeRaw(
      `SELECT DISTINCT c.id
       FROM gold.b2c_customers c
       JOIN gold.b2c_session_events se
         ON se.customer_id = c.id
         AND se.created_at > NOW() - INTERVAL '7 days'
       ORDER BY c.id
       LIMIT $1`,
      [BATCH_SIZE]
    )) as unknown as { id: string }[];

    let success = 0;
    let errors = 0;

    for (const customer of customers) {
      try {
        await ragNotifications({
          customer_id: customer.id,
          trigger_type: "scheduled_digest",
        });
        success++;
      } catch {
        errors++;
        // Individual failure should not break batch
      }
    }

    const elapsedMs = Date.now() - startMs;
    console.log(
      `[scheduler] Notification batch complete: ${success} sent, ${errors} failed, ${elapsedMs}ms`
    );
  } catch (err) {
    console.error("[scheduler] Notification batch failed:", err);
  }
}

export function initScheduler(): void {
  if (!CRON_ENABLED) {
    console.log("[scheduler] Notification cron disabled (NOTIFICATION_CRON_ENABLED != true)");
    return;
  }

  if (!cron.validate(MORNING_SCHEDULE)) {
    console.error(`[scheduler] Invalid morning cron: ${MORNING_SCHEDULE}`);
    return;
  }
  if (!cron.validate(EVENING_SCHEDULE)) {
    console.error(`[scheduler] Invalid evening cron: ${EVENING_SCHEDULE}`);
    return;
  }

  cron.schedule(MORNING_SCHEDULE, runNotificationBatch, {
    timezone: "America/New_York",
  });
  cron.schedule(EVENING_SCHEDULE, runNotificationBatch, {
    timezone: "America/New_York",
  });

  console.log(
    `[scheduler] Notification cron active: morning=${MORNING_SCHEDULE}, evening=${EVENING_SCHEDULE}`
  );
}
