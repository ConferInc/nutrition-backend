/**
 * server/services/nps.ts — B2C-026: NPS Survey
 *
 * Eligibility check (≥5 sessions + 60-day cooldown) and CRUD for responses.
 */

import { db, executeRaw } from "../config/database.js";
import { b2cNpsResponses } from "../../shared/goldSchema.js";

const SESSION_THRESHOLD = 5;
const COOLDOWN_DAYS = 60;

/**
 * Check if a user is eligible to see the NPS survey.
 * Eligible = ≥SESSION_THRESHOLD login sessions AND no NPS response in COOLDOWN_DAYS.
 */
export async function shouldShowNps(b2cCustomerId: string): Promise<boolean> {
  try {
    // 1. Count login sessions
    const sessions = await executeRaw(
      `SELECT COUNT(*)::int AS cnt FROM gold.b2c_session_events
       WHERE b2c_customer_id = $1 AND event_type = 'login'`,
      [b2cCustomerId]
    );
    if (!sessions || (sessions as any[])[0]?.cnt < SESSION_THRESHOLD) return false;

    // 2. Check for recent NPS response (submitted or dismissed)
    const recent = await executeRaw(
      `SELECT 1 FROM gold.b2c_nps_responses
       WHERE b2c_customer_id = $1 AND created_at > now() - interval '${COOLDOWN_DAYS} days'
       LIMIT 1`,
      [b2cCustomerId]
    );
    return !(recent as any[]).length;
  } catch (err) {
    // Never block user experience — log and return false
    console.error("[NPS] eligibility check failed:", (err as Error).message);
    return false;
  }
}

/**
 * Submit an NPS score (0-10) with optional feedback text.
 */
export async function submitNps(
  b2cCustomerId: string,
  score: number,
  feedbackText?: string
) {
  const rows = await db
    .insert(b2cNpsResponses)
    .values({
      b2cCustomerId,
      score,
      feedbackText: feedbackText ?? null,
      triggerType: "session_count",
      dismissed: false,
    })
    .returning();
  return rows[0];
}

/**
 * Record a dismissal ("Not now"). Counts toward the cooldown period.
 */
export async function dismissNps(b2cCustomerId: string) {
  const rows = await db
    .insert(b2cNpsResponses)
    .values({
      b2cCustomerId,
      score: null,
      feedbackText: null,
      triggerType: "session_count",
      dismissed: true,
    })
    .returning();
  return rows[0];
}
