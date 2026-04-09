// B2C-001: Notification scheduling via in-process cron
// Replaces the per-request trigger model with 2×/day batch processing.
import cron from "node-cron";
import { executeRaw } from "../config/database.js";
import { evaluateAndDispatchNotifications } from "./notificationEngine.js";
import { logger } from "../config/logger.js";

const CRON_ENABLED = process.env.NOTIFICATION_CRON_ENABLED === "true";
const MORNING_SCHEDULE = process.env.NOTIFICATION_CRON_MORNING ?? "0 8 * * *";
const EVENING_SCHEDULE = process.env.NOTIFICATION_CRON_EVENING ?? "0 18 * * *";
const BATCH_SIZE = parseInt(process.env.NOTIFICATION_CRON_BATCH_SIZE ?? "100", 10);
const CLEANUP_SCHEDULE = process.env.NOTIFICATION_CLEANUP_CRON ?? "0 3 * * 0"; // Sunday 3 AM

async function runNotificationBatch(): Promise<void> {
  const startMs = Date.now();
  logger.info(`[scheduler] Notification batch starting...`);

  try {
    // Fetch active customers who have used the platform recently (last 7 days)
    const customers = (await executeRaw(
      `SELECT DISTINCT c.id
       FROM gold.b2c_customers c
       JOIN gold.b2c_session_events se
          ON se.b2c_customer_id = c.id
         AND se.created_at > NOW() - INTERVAL '7 days'
       ORDER BY c.id
       LIMIT $1`,
      [BATCH_SIZE]
    )) as unknown as { id: string }[];

    let success = 0;
    let errors = 0;

    for (const customer of customers) {
      try {
        await evaluateAndDispatchNotifications(customer.id);
        success++;
      } catch {
        errors++;
        // Individual failure should not break batch
      }
    }

    const elapsedMs = Date.now() - startMs;
    logger.info(
      `[scheduler] Notification batch complete: ${success} sent, ${errors} failed, ${elapsedMs}ms`
    );
  } catch (err) {
    logger.error("[scheduler] Notification batch failed:", err);
  }
}

// ── Weekly Notification Cleanup ───────────────────────────────────────────

async function runNotificationCleanup(): Promise<void> {
  // ────────────────────────────────────────────────────────────
  // ⚠️ COMPLIANCE WARNING — DO NOT MODIFY
  // The audit_log table has a 6-year mandatory retention requirement
  // per HIPAA §164.530(j). NEVER add gold.audit_log to any cleanup,
  // purge, or archival job in this scheduler.
  // See: docs/hipaa-compliance/data_retention_policy.md
  // ────────────────────────────────────────────────────────────
  const startMs = Date.now();
  logger.info("[scheduler] Notification cleanup starting...");

  try {
    // Purge ALL notifications (read + unread) older than 30 days
    const deleted = await executeRaw(
      `DELETE FROM gold.b2c_notifications
       WHERE created_at < NOW() - INTERVAL '30 days'
       RETURNING customer_id`,
      []
    );
    const deletedRows = deleted as unknown as { customer_id: string }[];
    const affectedCustomers = [...new Set(deletedRows.map(r => r.customer_id))];

    // Also purge old dispatch log entries (dedup only needs current day)
    const purged = await executeRaw(
      `DELETE FROM gold.b2c_notification_dispatch_log
       WHERE trigger_date < CURRENT_DATE - INTERVAL '30 days'
       RETURNING b2c_customer_id`,
      []
    );
    const purgedRows = purged as unknown as { b2c_customer_id: string }[];
    const affectedDispatchCustomers = [...new Set(purgedRows.map(r => r.b2c_customer_id))];

    const elapsedMs = Date.now() - startMs;
    logger.info(
      `[scheduler] Cleanup done: ${deletedRows.length} notifications (${affectedCustomers.length} customers), ` +
      `${purgedRows.length} dispatch logs (${affectedDispatchCustomers.length} customers) purged (${elapsedMs}ms)`
    );
    if (affectedCustomers.length > 0) {
      logger.info(`[scheduler] Affected notification customers: ${affectedCustomers.join(", ")}`);
    }
    if (affectedDispatchCustomers.length > 0) {
      logger.info(`[scheduler] Affected dispatch log customers: ${affectedDispatchCustomers.join(", ")}`);
    }
  } catch (err) {
    logger.error("[scheduler] Notification cleanup failed:", err);
  }
}

export function initScheduler(): void {
  if (!CRON_ENABLED) {
    logger.info("[scheduler] Notification cron disabled (NOTIFICATION_CRON_ENABLED != true)");
    return;
  }

  if (!cron.validate(MORNING_SCHEDULE)) {
    logger.error(`[scheduler] Invalid morning cron: ${MORNING_SCHEDULE}`);
    return;
  }
  if (!cron.validate(EVENING_SCHEDULE)) {
    logger.error(`[scheduler] Invalid evening cron: ${EVENING_SCHEDULE}`);
    return;
  }

  cron.schedule(MORNING_SCHEDULE, runNotificationBatch, {
    timezone: "America/New_York",
  });
  cron.schedule(EVENING_SCHEDULE, runNotificationBatch, {
    timezone: "America/New_York",
  });
  cron.schedule(CLEANUP_SCHEDULE, runNotificationCleanup, {
    timezone: "America/New_York",
  });

  logger.info(
    `[scheduler] Notification cron active: morning=${MORNING_SCHEDULE}, evening=${EVENING_SCHEDULE}, cleanup=${CLEANUP_SCHEDULE}`
  );
}
