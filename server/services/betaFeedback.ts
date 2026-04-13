/**
 * server/services/betaFeedback.ts — Beta Feedback Service
 *
 * Handles eligibility checks (feature flag + throttle), submission,
 * dismissal, and "shown" recording for the beta feedback system.
 */

import { db, executeRaw } from "../config/database.js";
import {
  b2cBetaFeedback,
  b2cFeedbackThrottle,
} from "../../shared/goldSchema.js";
import { logger } from "../config/logger.js";

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_PROMPTS_PER_DAY = 2;   // across ALL flows per calendar day
const FEATURE_COOLDOWN_DAYS = 7; // per flow

// ── Feature flag ───────────────────────────────────────────────────────────

export function isBetaFeedbackEnabled(): boolean {
  const flag = process.env.ENABLE_BETA_FEEDBACK;
  return flag === "true" || flag === "1";
}

// ── Eligibility ────────────────────────────────────────────────────────────

/**
 * Determine whether a feedback prompt should be shown for the given flow.
 *
 * Gate 1: Global feature flag
 * Gate 2: Daily session cap (max 2 prompts per day across ALL flows)
 * Gate 3: Per-flow cooldown (max 1 prompt per flow per 7 days)
 */
export async function isEligible(
  customerId: string,
  flow: string
): Promise<boolean> {
  try {
    // Gate 1: Global flag
    if (!isBetaFeedbackEnabled()) return false;

    // Gate 2: Daily cap — count all flows shown today
    const todayRows = await executeRaw(
      `SELECT COALESCE(SUM(session_count), 0)::int AS cnt
       FROM gold.b2c_feedback_throttle
       WHERE b2c_customer_id = $1
         AND last_shown_at::date = CURRENT_DATE`,
      [customerId]
    );
    if ((todayRows as any[])[0]?.cnt >= MAX_PROMPTS_PER_DAY) return false;

    // Gate 3: Per-flow cooldown
    const flowRows = await executeRaw(
      `SELECT last_shown_at
       FROM gold.b2c_feedback_throttle
       WHERE b2c_customer_id = $1 AND flow = $2`,
      [customerId, flow]
    );
    if ((flowRows as any[]).length > 0) {
      const lastShown = new Date((flowRows as any[])[0].last_shown_at);
      const daysSince =
        (Date.now() - lastShown.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < FEATURE_COOLDOWN_DAYS) return false;
    }

    return true;
  } catch (err) {
    // Never block user experience — log and return false
    logger.error("[BetaFeedback] eligibility check failed:", (err as Error).message);
    return false;
  }
}

// ── Record "shown" (throttle UPSERT) ───────────────────────────────────────

/**
 * Record that a feedback prompt was displayed to the user.
 * Upserts the throttle row: updates last_shown_at and increments session_count.
 */
export async function recordShown(
  customerId: string,
  flow: string
): Promise<void> {
  try {
    await executeRaw(
      `INSERT INTO gold.b2c_feedback_throttle (b2c_customer_id, flow, last_shown_at, session_count)
       VALUES ($1, $2, NOW(), 1)
       ON CONFLICT (b2c_customer_id, flow)
       DO UPDATE SET last_shown_at = NOW(),
                     session_count = gold.b2c_feedback_throttle.session_count + 1`,
      [customerId, flow]
    );
  } catch (err) {
    logger.error("[BetaFeedback] recordShown failed:", (err as Error).message);
  }
}

// ── Submit feedback ────────────────────────────────────────────────────────

export interface FeedbackSubmission {
  flow: string;
  questionKey: string;
  responseValue?: string;
  followUpText?: string;
  followUpTags?: string[];
  isSafetyFlag?: boolean;
  contextMetadata?: Record<string, unknown>;
}

export async function submitFeedback(
  customerId: string,
  data: FeedbackSubmission
) {
  const rows = await db
    .insert(b2cBetaFeedback)
    .values({
      b2cCustomerId: customerId,
      flow: data.flow,
      questionKey: data.questionKey,
      responseValue: data.responseValue ?? null,
      followUpText: data.followUpText ?? null,
      followUpTags: data.followUpTags ?? [],
      isSafetyFlag: data.isSafetyFlag ?? false,
      contextMetadata: data.contextMetadata ?? {},
      dismissed: false,
    })
    .returning();

  if (data.isSafetyFlag) {
    logger.warn(
      `[BetaFeedback] SAFETY FLAG — customer=${customerId} flow=${data.flow} key=${data.questionKey}`
    );
  }

  return rows[0];
}

// ── Dismiss feedback ───────────────────────────────────────────────────────

export async function dismissFeedback(
  customerId: string,
  flow: string
) {
  const rows = await db
    .insert(b2cBetaFeedback)
    .values({
      b2cCustomerId: customerId,
      flow,
      questionKey: "dismissed",
      responseValue: null,
      followUpText: null,
      followUpTags: [],
      isSafetyFlag: false,
      contextMetadata: {},
      dismissed: true,
    })
    .returning();
  return rows[0];
}
