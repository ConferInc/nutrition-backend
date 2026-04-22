// ─── Campaigns Router ────────────────────────────────────────────────────────
// CRUD for vendor-scoped email/message campaigns
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import { requireAuth, requirePermissionMiddleware } from "../lib/auth.js";
import { db } from "../lib/database.js";
import { sql } from "drizzle-orm";
import { sendBulkEmail, shuffleInPlace } from "../services/email/bulk-sender.js";
import { renderCampaignEmail } from "../services/email/templates.js";
import { resolveSegmentById, resolveSegmentEmailsById } from "./segments.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function recordSentEvents(
  campaignId: string,
  vendorId: string,
  emails: string[],
  variant: "a" | "b" | null,
): Promise<void> {
  if (!emails.length) return;
  try {
    const variantSql = variant ? `'${variant}'` : "NULL";
    const rows = emails
      .map((e) => `(gen_random_uuid(),'${campaignId}'::uuid,'${vendorId}'::uuid,'${e.replace(/'/g, "''")}','sent',${variantSql},now())`)
      .join(",");
    await db.execute(sql.raw(`
      INSERT INTO gold.b2b_campaign_events
        (id, campaign_id, vendor_id, recipient_email, event_type, ab_variant, occurred_at)
      VALUES ${rows}
      ON CONFLICT DO NOTHING
    `));
  } catch (err: any) {
    logger.warn(`[campaigns] Failed to record sent events for ${campaignId}: ${err?.message}`);
  }
}

const VALID_SEGMENTS = ["all", "active", "with_profile", "inactive"] as const;
type Segment = typeof VALID_SEGMENTS[number];
const VALID_STATUSES = ["draft", "active", "sent"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSegment(s: string): boolean {
  return VALID_SEGMENTS.includes(s as Segment) || UUID_RE.test(s);
}

// ── Segment SQL helper ───────────────────────────────────────────────────────
// Returns { count, members[] } for a vendor + segment combination.
// Pass excludeOptOut=true when sending to filter out email_opt_out customers.
// If segment is a UUID, resolves via the b2b_member_segments rule engine.
async function resolveSegment(vendorId: string, segment: string, excludeOptOut = false) {
  // Delegate to saved segment rule engine when segment is a UUID.
  if (UUID_RE.test(segment)) {
    return resolveSegmentById(vendorId, segment, excludeOptOut, 100);
  }

  let whereClause: string;
  switch (segment) {
    case "active":
      whereClause = `c.account_status = 'active'`;
      break;
    case "inactive":
      whereClause = `c.account_status = 'inactive'`;
      break;
    case "with_profile":
      whereClause = `EXISTS (
        SELECT 1 FROM gold.b2b_customer_health_profiles hp
        WHERE hp.customer_id = c.id OR hp.b2b_customer_id = c.id
      )`;
      break;
    case "all":
    default:
      whereClause = `true`;
      break;
  }

  // Compliance: exclude customers who have opted out of marketing emails.
  // Requires the email_opt_out column (migration: ALTER TABLE gold.b2b_customers ADD COLUMN email_opt_out BOOLEAN DEFAULT FALSE).
  const optOutFilter = excludeOptOut
    ? `AND (c.email_opt_out IS NULL OR c.email_opt_out = false) AND c.email IS NOT NULL`
    : "";

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM gold.b2b_customers c
    WHERE c.vendor_id = ${vendorId}::uuid
      AND ${sql.raw(whereClause)}
      ${sql.raw(optOutFilter)}
  `);
  const count = (countResult.rows?.[0] as any)?.count ?? 0;

  const membersResult = await db.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.email
    FROM gold.b2b_customers c
    WHERE c.vendor_id = ${vendorId}::uuid
      AND ${sql.raw(whereClause)}
      ${sql.raw(optOutFilter)}
    ORDER BY c.created_at DESC
    LIMIT 100
  `);
  return { count, members: membersResult.rows ?? [] };
}

// ── Send recipient resolver (no LIMIT) ───────────────────────────────────────
// Returns all opted-in emails for a segment. Used exclusively by the send endpoint.
// If segment is a UUID, resolves via the b2b_member_segments rule engine.
async function resolveAllRecipients(vendorId: string, segment: string): Promise<string[]> {
  if (UUID_RE.test(segment)) {
    return resolveSegmentEmailsById(vendorId, segment);
  }

  let whereClause: string;
  switch (segment) {
    case "active":
      whereClause = `c.account_status = 'active'`;
      break;
    case "inactive":
      whereClause = `c.account_status = 'inactive'`;
      break;
    case "with_profile":
      whereClause = `EXISTS (
        SELECT 1 FROM gold.b2b_customer_health_profiles hp
        WHERE hp.customer_id = c.id OR hp.b2b_customer_id = c.id
      )`;
      break;
    case "all":
    default:
      whereClause = `true`;
      break;
  }

  const result = await db.execute(sql`
    SELECT c.email
    FROM gold.b2b_customers c
    WHERE c.vendor_id = ${vendorId}::uuid
      AND c.email IS NOT NULL
      AND (c.email_opt_out IS NULL OR c.email_opt_out = false)
      AND ${sql.raw(whereClause)}
    ORDER BY c.id
  `);
  return (result.rows ?? []).map((r: any) => r.email).filter(Boolean);
}

// ── GET /campaigns/segment-preview ──────────────────────────────────────────
// ?segment=all|active|inactive|with_profile
// Returns { count, segment } — used by the create dialog for live preview
router.get(
  "/segment-preview",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const segment = (req.query.segment as string) ?? "all";
    if (!isValidSegment(segment)) {
      return res.status(400).json({ code: "bad_request", detail: `segment must be one of: ${VALID_SEGMENTS.join(", ")} or a saved segment UUID` });
    }

    try {
      const { count } = await resolveSegment(vendorId, segment as Segment);
      return res.json({ segment, count });
    } catch (err: any) {
      console.error("[campaigns] GET /segment-preview error:", err?.message || err);
      return res.status(500).json({ code: "internal_error", detail: "Failed to resolve segment" });
    }
  },
);

// ── GET /campaigns ───────────────────────────────────────────────────────────
router.get(
  "/",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });
    try {
      const result = await db.execute(sql`
        SELECT id, name, target_segment, subject, message, status, sent_at,
               recipient_count, ab_test_enabled, subject_b, message_b, created_at, updated_at
        FROM gold.b2b_campaigns
        WHERE vendor_id = ${vendorId}::uuid
        ORDER BY created_at DESC
      `);
      return res.json({ campaigns: result.rows ?? [] });
    } catch (err: any) {
      console.error("[campaigns] GET / error:", err?.message || err);
      return res.status(500).json({ code: "internal_error", detail: "Failed to fetch campaigns" });
    }
  },
);

// ── POST /campaigns ──────────────────────────────────────────────────────────
router.post(
  "/",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const { name, target_segment = "all", subject, message, ab_test_enabled, subject_b, message_b } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ code: "bad_request", detail: "name is required" });
    if (!subject?.trim()) return res.status(400).json({ code: "bad_request", detail: "subject is required" });
    if (!message?.trim()) return res.status(400).json({ code: "bad_request", detail: "message is required" });
    if (!isValidSegment(target_segment)) {
      return res.status(400).json({ code: "bad_request", detail: `target_segment must be one of: ${VALID_SEGMENTS.join(", ")} or a saved segment UUID` });
    }
    const abEnabled = Boolean(ab_test_enabled);
    const subjectB = abEnabled ? (subject_b?.trim() ?? null) : null;
    const messageB = abEnabled ? (message_b?.trim() ?? null) : null;

    try {
      const result = await db.execute(sql`
        INSERT INTO gold.b2b_campaigns (vendor_id, name, target_segment, subject, message, ab_test_enabled, subject_b, message_b)
        VALUES (${vendorId}::uuid, ${name.trim()}, ${target_segment}, ${subject.trim()}, ${message.trim()}, ${abEnabled}, ${subjectB}, ${messageB})
        RETURNING id, name, target_segment, subject, message, status, sent_at,
                  recipient_count, ab_test_enabled, subject_b, message_b, created_at, updated_at
      `);
      return res.status(201).json({ campaign: result.rows?.[0] });
    } catch (err: any) {
      console.error("[campaigns] POST / error:", err?.message || err);
      return res.status(500).json({ code: "internal_error", detail: "Failed to create campaign" });
    }
  },
);

// ── GET /campaigns/:id/recipients ────────────────────────────────────────────
// Returns the resolved member list for a campaign's target_segment
router.get(
  "/:id/recipients",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const { id } = req.params;
    try {
      const campaignResult = await db.execute(sql`
        SELECT target_segment FROM gold.b2b_campaigns
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
      `);
      if (!campaignResult.rows?.length) {
        return res.status(404).json({ code: "not_found", detail: "Campaign not found" });
      }
      const segment = (campaignResult.rows[0] as any).target_segment as string;
      const { count, members } = await resolveSegment(vendorId, segment);
      return res.json({ segment, count, members });
    } catch (err: any) {
      console.error("[campaigns] GET /:id/recipients error:", err?.message || err);
      return res.status(500).json({ code: "internal_error", detail: "Failed to resolve recipients" });
    }
  },
);

// ── PATCH /campaigns/:id ─────────────────────────────────────────────────────
router.patch(
  "/:id",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const { id } = req.params;
    const { status } = req.body || {};
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ code: "bad_request", detail: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    try {
      // When activating, resolve the segment count and store it
      let recipientCount: number | null = null;
      if (status === "active") {
        const campaignResult = await db.execute(sql`
          SELECT target_segment FROM gold.b2b_campaigns
          WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
        `);
        if (campaignResult.rows?.length) {
          const segment = (campaignResult.rows[0] as any).target_segment as string;
          const { count } = await resolveSegment(vendorId, segment);
          recipientCount = count;
        }
      }

      const result = await db.execute(sql`
        UPDATE gold.b2b_campaigns
        SET status = ${status},
            sent_at = CASE WHEN ${status} = 'sent' THEN now() ELSE sent_at END,
            recipient_count = CASE WHEN ${recipientCount !== null} THEN ${recipientCount} ELSE recipient_count END,
            updated_at = now()
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
        RETURNING id, name, status, sent_at, recipient_count, updated_at
      `);
      if (!result.rows?.length) {
        return res.status(404).json({ code: "not_found", detail: "Campaign not found" });
      }
      return res.json({ campaign: result.rows[0] });
    } catch (err: any) {
      console.error("[campaigns] PATCH /:id error:", err?.message || err);
      return res.status(500).json({ code: "internal_error", detail: "Failed to update campaign" });
    }
  },
);

// ── DELETE /campaigns/:id ────────────────────────────────────────────────────
router.delete(
  "/:id",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const { id } = req.params;
    try {
      const result = await db.execute(sql`
        DELETE FROM gold.b2b_campaigns
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid AND status = 'draft'
        RETURNING id
      `);
      if (!result.rows?.length) {
        return res.status(404).json({ code: "not_found", detail: "Campaign not found or not in draft status" });
      }
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[campaigns] DELETE /:id error:", err?.message || err);
      return res.status(500).json({ code: "internal_error", detail: "Failed to delete campaign" });
    }
  },
);

// ── POST /campaigns/:id/send ─────────────────────────────────────────────────
// Sends the campaign to all opted-in segment recipients via SendGrid.
// Guards against double-sends (409 if already sent).
router.post(
  "/:id/send",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const { id } = req.params;
    try {
      // 1. Fetch campaign
      const campResult = await db.execute(sql`
        SELECT id, name, target_segment, subject, message, status
        FROM gold.b2b_campaigns
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
      `);
      if (!campResult.rows?.length) {
        return res.status(404).json({ code: "not_found", detail: "Campaign not found" });
      }
      const campaign = campResult.rows[0] as any;
      if (campaign.status === "sent") {
        return res.status(409).json({ code: "already_sent", detail: "Campaign has already been sent" });
      }

      // 2. Resolve ALL opted-in recipients
      const emails = await resolveAllRecipients(vendorId, campaign.target_segment as string);
      if (!emails.length) {
        return res.status(422).json({ code: "no_recipients", detail: "No opted-in recipients found for this segment" });
      }

      const abEnabled: boolean = Boolean(campaign.ab_test_enabled);
      let totalSent = 0;
      let skipped = false;

      if (abEnabled && campaign.subject_b && campaign.message_b) {
        // ── A/B split: shuffle and send first half as variant A, second as variant B ─
        const shuffled = shuffleInPlace([...emails]);
        const mid = Math.ceil(shuffled.length / 2);
        const groupA = shuffled.slice(0, mid);
        const groupB = shuffled.slice(mid);

        const htmlA = renderCampaignEmail(campaign.subject, campaign.message);
        const htmlB = renderCampaignEmail(campaign.subject_b, campaign.message_b);

        const [resultA, resultB] = await Promise.all([
          sendBulkEmail(groupA, campaign.subject, htmlA),
          sendBulkEmail(groupB, campaign.subject_b, htmlB),
        ]);
        totalSent = resultA.sent + resultB.sent;
        skipped = resultA.skipped && resultB.skipped;

        // Record sent events with variant tag
        if (!skipped) {
          await recordSentEvents(id, vendorId, groupA, "a");
          await recordSentEvents(id, vendorId, groupB, "b");
        }
      } else {
        // ── Standard send: all recipients get variant A ──────────────────────
        const html = renderCampaignEmail(campaign.subject, campaign.message);
        const result = await sendBulkEmail(emails, campaign.subject, html);
        totalSent = result.sent;
        skipped = result.skipped;

        if (!skipped) {
          await recordSentEvents(id, vendorId, emails, null);
        }
      }

      // 4. Mark campaign as sent
      await db.execute(sql`
        UPDATE gold.b2b_campaigns
        SET status = 'sent', sent_at = now(), recipient_count = ${emails.length}, updated_at = now()
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
      `);

      return res.json({ ok: true, sent: totalSent, skipped, ab_enabled: abEnabled });
    } catch (err: any) {
      console.error("[campaigns] POST /:id/send error:", err?.message || err);
      return res.status(500).json({ code: "internal_error", detail: "Failed to send campaign" });
    }
  },
);

// ── POST /campaigns/:id/pick-winner ──────────────────────────────────────────
// After reviewing A/B analytics, admin picks the winning variant (a or b).
// This sends the winner's subject+message to the OTHER half of the audience
// (those who received variant B get A, and vice versa) so every recipient
// ends up receiving the winning content.
router.post(
  "/:id/pick-winner",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const { id } = req.params;
    const { winner } = req.body ?? {};
    if (winner !== "a" && winner !== "b") {
      return res.status(400).json({ code: "bad_request", detail: "winner must be 'a' or 'b'" });
    }

    try {
      // Fetch campaign
      const campResult = await db.execute(sql`
        SELECT id, subject, message, subject_b, message_b, status, ab_test_enabled, ab_winner
        FROM gold.b2b_campaigns
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
      `);
      if (!campResult.rows?.length) {
        return res.status(404).json({ code: "not_found", detail: "Campaign not found" });
      }
      const campaign = campResult.rows[0] as any;

      if (!campaign.ab_test_enabled) {
        return res.status(422).json({ code: "not_ab", detail: "This campaign does not have A/B testing enabled" });
      }
      if (campaign.status !== "sent") {
        return res.status(422).json({ code: "not_sent", detail: "Campaign must be sent before picking a winner" });
      }
      if (campaign.ab_winner) {
        return res.status(409).json({ code: "winner_already_set", detail: `Winner already set to variant ${campaign.ab_winner}` });
      }

      // Find recipients who got the LOSING variant — send them the winner content
      const losingVariant = winner === "a" ? "b" : "a";
      const losingResult = await db.execute(sql`
        SELECT DISTINCT recipient_email
        FROM gold.b2b_campaign_events
        WHERE campaign_id = ${id}::uuid
          AND event_type = 'sent'
          AND ab_variant = ${losingVariant}
      `);
      const losingEmails = (losingResult.rows ?? []).map((r: any) => r.recipient_email).filter(Boolean);

      if (!losingEmails.length) {
        return res.status(422).json({ code: "no_recipients", detail: "No recipients found for the losing variant" });
      }

      // Send winner content to losing-variant recipients
      const winSubject = winner === "a" ? campaign.subject : campaign.subject_b;
      const winMessage = winner === "a" ? campaign.message : campaign.message_b;
      const html = renderCampaignEmail(winSubject, winMessage);
      const result = await sendBulkEmail(losingEmails, winSubject, html);

      // Record winner-send events
      if (!result.skipped) {
        await recordSentEvents(id, vendorId, losingEmails, winner);
      }

      // Persist winner choice
      await db.execute(sql`
        UPDATE gold.b2b_campaigns SET ab_winner = ${winner}, updated_at = now()
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
      `);

      return res.json({ ok: true, winner, sent_to_losing_group: result.sent, skipped: result.skipped });
    } catch (err: any) {
      logger.error(`[campaigns] POST /:id/pick-winner error: ${err?.message}`);
      return res.status(500).json({ code: "internal_error", detail: "Failed to pick winner" });
    }
  },
);

// ── GET /campaigns/:id/analytics ─────────────────────────────────────────────
// Returns open rate, CTR, bounce rate, and unsubscribe rate for a sent campaign.
router.get(
  "/:id/analytics",
  requireAuth as any,
  requirePermissionMiddleware("manage:settings") as any,
  async (req: Request, res: Response) => {
    const vendorId = (req as any).auth?.vendorId;
    if (!vendorId) return res.status(403).json({ code: "forbidden", detail: "No vendor context" });

    const { id } = req.params;
    try {
      // Verify campaign belongs to this vendor
      const campCheck = await db.execute(sql`
        SELECT id, recipient_count FROM gold.b2b_campaigns
        WHERE id = ${id}::uuid AND vendor_id = ${vendorId}::uuid
      `);
      if (!campCheck.rows?.length) {
        return res.status(404).json({ code: "not_found", detail: "Campaign not found" });
      }
      const recipientCount = (campCheck.rows[0] as any).recipient_count ?? 0;

      const eventsResult = await db.execute(sql`
        SELECT
          event_type,
          ab_variant,
          COUNT(DISTINCT recipient_email)::int AS unique_count
        FROM gold.b2b_campaign_events
        WHERE campaign_id = ${id}::uuid
        GROUP BY event_type, ab_variant
      `);

      // Aggregate totals + per-variant breakdown
      const totals: Record<string, number> = {};
      const variantA: Record<string, number> = {};
      const variantB: Record<string, number> = {};

      for (const row of (eventsResult.rows ?? []) as any[]) {
        const { event_type, ab_variant, unique_count } = row;
        totals[event_type] = (totals[event_type] ?? 0) + unique_count;
        if (ab_variant === "a") variantA[event_type] = (variantA[event_type] ?? 0) + unique_count;
        if (ab_variant === "b") variantB[event_type] = (variantB[event_type] ?? 0) + unique_count;
      }

      const sent = totals["sent"] ?? recipientCount;
      const rate = (n: number, base = sent) => base > 0 ? Math.round((n / base) * 10000) / 100 : 0;

      const variantStats = (v: Record<string, number>) => {
        const s = v["sent"] ?? 0;
        return {
          sent: s,
          opened: v["opened"] ?? 0,
          clicked: v["clicked"] ?? 0,
          open_rate: rate(v["opened"] ?? 0, s),
          click_rate: rate(v["clicked"] ?? 0, s),
        };
      };

      return res.json({
        campaign_id: id,
        sent,
        opened: totals["opened"] ?? 0,
        clicked: totals["clicked"] ?? 0,
        bounced: totals["bounced"] ?? 0,
        complained: totals["complained"] ?? 0,
        unsubscribed: totals["unsubscribed"] ?? 0,
        open_rate: rate(totals["opened"] ?? 0),
        click_rate: rate(totals["clicked"] ?? 0),
        bounce_rate: rate(totals["bounced"] ?? 0),
        variants: {
          a: variantStats(variantA),
          b: variantStats(variantB),
        },
      });
    } catch (err: any) {
      logger.error(`[campaigns] GET /:id/analytics error: ${err?.message}`);
      return res.status(500).json({ code: "internal_error", detail: "Failed to fetch analytics" });
    }
  },
);

export default router;
