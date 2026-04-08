/**
 * server/services/featureTracking.ts — B2C-021: Feature Usage Analytics
 *
 * Fire-and-forget feature event logging.
 * All inserts are async and never block the user request.
 *
 * Usage:
 *   trackFeature(customerId, "meal_plan", "generate", { mealsPerDay: 3 });
 */

import { executeRaw } from "../config/database.js";
import { logger } from "../config/logger.js";

/**
 * Log a feature usage event. Fire-and-forget — caller should `.catch(() => {})`.
 *
 * @param b2cCustomerId - The customer UUID
 * @param featureName   - e.g. 'meal_plan', 'grocery_list', 'recipe_save', 'chatbot', 'scan', 'recipe_analyze', 'meal_log', 'nutrition', 'notifications'
 * @param action        - e.g. 'generate', 'create', 'view', 'update', 'delete', 'export', 'message', 'scan', 'analyze', 'read'
 * @param metadata      - Optional feature-specific data (items_count, generation_time_ms, etc.)
 * @param durationMs    - Optional: how long the operation took
 */
export function trackFeature(
  b2cCustomerId: string | undefined,
  featureName: string,
  action: string,
  metadata?: Record<string, unknown>,
  durationMs?: number
): void {
  if (!b2cCustomerId) return;

  executeRaw(
    `INSERT INTO gold.b2c_feature_events
       (b2c_customer_id, feature_name, action, metadata, duration_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      b2cCustomerId,
      featureName,
      action,
      metadata ? JSON.stringify(metadata) : "{}",
      durationMs ?? null,
    ]
  ).catch((err) => {
    logger.error("[FEATURE-TRACK]", (err as Error).message);
  });
}
