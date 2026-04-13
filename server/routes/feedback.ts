/**
 * server/routes/feedback.ts — Beta Feedback API Endpoints
 *
 * 4 endpoints for the in-app beta feedback system:
 *  - GET  /eligible?flow={flow}   — check if prompt should show
 *  - POST /                       — submit a feedback response
 *  - POST /dismiss                — record a dismissal (analytics)
 *  - POST /shown                  — record that prompt was displayed (throttle)
 */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import {
  isEligible,
  submitFeedback,
  dismissFeedback,
  recordShown,
  isBetaFeedbackEnabled,
} from "../services/betaFeedback.js";
import { trackFeature } from "../services/featureTracking.js";
import { z } from "zod";

const router = Router();
router.use(authMiddleware);
router.use(rateLimitMiddleware);

// Helper to extract b2cCustomerId from request
function b2cCustomerId(req: any): string {
  const id = req.user?.b2cCustomerId;
  if (!id) throw Object.assign(new Error("Customer ID required"), { statusCode: 401 });
  return id;
}

// Valid flow codes
const VALID_FLOWS = [
  "feed",
  "nutrition",
  "meal_plan",
  "ai_chat",
  "recipe_analyzer",
  "search",
  "grocery_substitutions",
] as const;

const flowSchema = z.enum(VALID_FLOWS);

// ── GET /eligible?flow={flow} ─────────────────────────────────────────────

/**
 * @openapi
 * /feedback/eligible:
 *   get:
 *     tags: [Feedback]
 *     summary: Check if user is eligible for a feedback prompt
 *     parameters:
 *       - in: query
 *         name: flow
 *         required: true
 *         schema: { type: string, enum: [feed, meal_plan, ai_chat, recipe_analyzer, search, grocery_substitutions] }
 *     responses:
 *       200: { description: Eligibility status }
 */
router.get("/eligible", async (req, res, next) => {
  try {
    const customerId = b2cCustomerId(req);
    const flow = flowSchema.parse(req.query.flow);
    const eligible = await isEligible(customerId, flow);
    res.json({ eligible });
  } catch (err) {
    next(err);
  }
});

// ── POST / ── Submit feedback response ────────────────────────────────────

const submitSchema = z.object({
  flow: flowSchema,
  questionKey: z.string().max(50),
  responseValue: z.string().max(100).optional(),
  followUpText: z.string().max(2000).optional(),
  followUpTags: z.array(z.string().max(50)).max(10).optional(),
  isSafetyFlag: z.boolean().optional(),
  contextMetadata: z.record(z.unknown()).optional(),
});

/**
 * @openapi
 * /feedback:
 *   post:
 *     tags: [Feedback]
 *     summary: Submit a beta feedback response
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [flow, questionKey]
 *             properties:
 *               flow: { type: string }
 *               questionKey: { type: string }
 *               responseValue: { type: string }
 *               followUpText: { type: string }
 *               followUpTags: { type: array, items: { type: string } }
 *               isSafetyFlag: { type: boolean }
 *               contextMetadata: { type: object }
 *     responses:
 *       201: { description: Feedback recorded }
 */
router.post("/", async (req, res, next) => {
  try {
    if (!isBetaFeedbackEnabled()) return res.status(404).json({ error: "Beta feedback is disabled" });
    const customerId = b2cCustomerId(req);
    const data = submitSchema.parse(req.body);
    const response = await submitFeedback(customerId, data);
    trackFeature(customerId, "beta_feedback", "submit", {
      flow: data.flow,
      questionKey: data.questionKey,
    });
    res.status(201).json({ response });
  } catch (err) {
    next(err);
  }
});

// ── POST /dismiss ── Record dismissal ─────────────────────────────────────

const dismissSchema = z.object({
  flow: flowSchema,
});

/**
 * @openapi
 * /feedback/dismiss:
 *   post:
 *     tags: [Feedback]
 *     summary: Record a feedback dismissal
 *     responses:
 *       200: { description: Dismissal recorded }
 */
router.post("/dismiss", async (req, res, next) => {
  try {
    if (!isBetaFeedbackEnabled()) return res.status(404).json({ error: "Beta feedback is disabled" });
    const customerId = b2cCustomerId(req);
    const { flow } = dismissSchema.parse(req.body);
    await dismissFeedback(customerId, flow);
    trackFeature(customerId, "beta_feedback", "dismiss", { flow });
    res.json({ dismissed: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /shown ── Record that prompt was displayed ───────────────────────

const shownSchema = z.object({
  flow: flowSchema,
});

/**
 * @openapi
 * /feedback/shown:
 *   post:
 *     tags: [Feedback]
 *     summary: Record that a feedback prompt was displayed (throttle update)
 *     responses:
 *       200: { description: Shown recorded }
 */
router.post("/shown", async (req, res, next) => {
  try {
    if (!isBetaFeedbackEnabled()) return res.status(404).json({ error: "Beta feedback is disabled" });
    const customerId = b2cCustomerId(req);
    const { flow } = shownSchema.parse(req.body);
    await recordShown(customerId, flow);
    res.json({ recorded: true });
  } catch (err) {
    next(err);
  }
});

export default router;
