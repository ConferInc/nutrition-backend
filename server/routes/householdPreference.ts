import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { getOrCreateHousehold } from "../services/household.js";
import {
  getHouseholdPreferences,
  setHouseholdPreference,
  deleteHouseholdPreference,
} from "../services/householdPreference.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

// ── Validation ──────────────────────────────────────────────────────────────

const setPreferenceSchema = z.object({
  preferenceType: z.string().min(1).max(50),
  preferenceValue: z.string().min(1).max(255),
  priority: z.number().int().optional(),
});

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /households/preferences:
 *   get:
 *     tags: [Household Preferences]
 *     summary: Get household preferences
 *     responses:
 *       200: { description: List of household preferences }
 */
router.get(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      const preferences = await getHouseholdPreferences(household.id);
      res.json({ preferences });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /households/preferences:
 *   post:
 *     tags: [Household Preferences]
 *     summary: Set a household preference
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [preferenceType, preferenceValue]
 *             properties:
 *               preferenceType: { type: string, maxLength: 50 }
 *               preferenceValue: { type: string, maxLength: 255 }
 *               priority: { type: integer }
 *     responses:
 *       200: { description: Preference set }
 */
router.post(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      const parsed = setPreferenceSchema.parse(req.body);
      const preference = await setHouseholdPreference(
        household.id,
        parsed.preferenceType,
        parsed.preferenceValue,
        parsed.priority
      );
      res.json({ preference });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /households/preferences/{id}:
 *   delete:
 *     tags: [Household Preferences]
 *     summary: Delete a household preference
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Preference deleted }
 */
router.delete(
  "/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      await deleteHouseholdPreference(req.params.id, household.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
