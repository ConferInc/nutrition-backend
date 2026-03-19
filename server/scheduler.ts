// server/scheduler.ts
// PRD-29: Background notification cron scheduler
// ─────────────────────────────────────────────────

import cron from "node-cron";
import {
    evaluateAndDispatchNotifications,
    getActiveCustomerIds,
} from "./services/notificationEngine.js";

export function startNotificationCron(): void {
    if (process.env.NOTIFICATION_CRON_ENABLED !== "true") {
        console.log("[CRON] Notification scheduler disabled (NOTIFICATION_CRON_ENABLED != true)");
        return;
    }

    // PRD-32: 4 batches at 05,11,17,21 UTC — optimized for global timezone coverage
    // Each user's triggers are timezone-aware; the daily cap limits total per user
    cron.schedule("0 5,11,17,21 * * *", async () => {
        console.log("[CRON] Starting notification batch evaluation...");
        const start = Date.now();

        try {
            const customerIds = await getActiveCustomerIds();
            let totalDispatched = 0;
            let totalCapped = 0;

            for (const id of customerIds) {
                try {
                    const result = await evaluateAndDispatchNotifications(id);
                    totalDispatched += result.dispatched;
                    if (result.capped) totalCapped++;
                } catch (err) {
                    console.error(`[CRON] Error evaluating customer ${id}:`, err);
                }
            }

            const elapsed = Date.now() - start;
            console.log(
                `[CRON] Batch complete: ${customerIds.length} customers, ${totalDispatched} dispatched, ${totalCapped} capped, ${elapsed}ms`
            );
        } catch (err) {
            console.error("[CRON] Batch evaluation failed:", err);
        }
    });

    console.log("[CRON] Notification scheduler started (4x daily: 05,11,17,21 UTC — timezone-aware evaluation)");
}
