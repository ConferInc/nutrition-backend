/**
 * server/routes/nps.ts — B2C-026: NPS Survey Endpoints
 */

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { shouldShowNps, submitNps, dismissNps } from "../services/nps.js";
import { trackFeature } from "../services/featureTracking.js";
import { z } from "zod";

const router = Router();
router.use(authMiddleware);
router.use(rateLimitMiddleware);

// Helper to extract b2cCustomerId from request
function b2cCustomerId(req: any): string {
  const id = req.auth?.b2cCustomerId;
  if (!id) throw Object.assign(new Error("Customer ID required"), { statusCode: 401 });
  return id;
}

/**
 * @openapi
 * /nps/eligible:
 *   get:
 *     tags: [NPS]
 *     summary: Check if user is eligible for NPS survey
 *     description: Returns eligible=true if user has ≥5 sessions and no NPS response in last 60 days
 *     responses:
 *       200:
 *         description: Eligibility status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 eligible: { type: boolean }
 */
router.get("/eligible", async (req, res, next) => {
  try {
    const customerId = b2cCustomerId(req);
    const eligible = await shouldShowNps(customerId);
    res.json({ eligible });
  } catch (err) {
    next(err);
  }
});

const submitSchema = z.object({
  score: z.number().int().min(0).max(10),
  feedbackText: z.string().max(2000).optional(),
});

/**
 * @openapi
 * /nps:
 *   post:
 *     tags: [NPS]
 *     summary: Submit NPS survey response
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [score]
 *             properties:
 *               score: { type: integer, minimum: 0, maximum: 10 }
 *               feedbackText: { type: string, maxLength: 2000 }
 *     responses:
 *       201: { description: NPS response recorded }
 */
router.post("/", async (req, res, next) => {
  try {
    const customerId = b2cCustomerId(req);
    const { score, feedbackText } = submitSchema.parse(req.body);
    const response = await submitNps(customerId, score, feedbackText);
    trackFeature(customerId, "nps", "submit", { score });
    res.status(201).json({ response });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /nps/dismiss:
 *   post:
 *     tags: [NPS]
 *     summary: Dismiss NPS survey (counts toward cooldown)
 *     responses:
 *       200: { description: Dismissal recorded }
 */
router.post("/dismiss", async (req, res, next) => {
  try {
    const customerId = b2cCustomerId(req);
    await dismissNps(customerId);
    trackFeature(customerId, "nps", "dismiss");
    res.json({ dismissed: true });
  } catch (err) {
    next(err);
  }
});

export default router;
