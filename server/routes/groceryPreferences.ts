import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { getOrCreateHousehold } from "../services/household.js";
import {
  getAllCertifications,
  getGroceryPreferences,
  updateGroceryPreferences,
  searchBrands,
} from "../services/groceryPreferences.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

// ── Validation ──────────────────────────────────────────────────────────────

const updatePreferencesSchema = z.object({
  certificationIds: z.array(z.string().uuid()).optional(),
  brands: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        priority: z.number().int().min(1),
      })
    )
    .optional(),
  mealsPerDay: z.number().int().min(1).max(10).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
});

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /grocery-preferences/certifications:
 *   get:
 *     tags: [Grocery Preferences]
 *     summary: List all available certifications
 *     responses:
 *       200: { description: List of certifications }
 */
router.get(
  "/certifications",
  rateLimitMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const certs = await getAllCertifications();
      res.json({ certifications: certs });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-preferences:
 *   get:
 *     tags: [Grocery Preferences]
 *     summary: Get household grocery preferences
 *     responses:
 *       200: { description: Current grocery preferences }
 */
router.get(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      const preferences = await getGroceryPreferences(household.id);
      res.json({ preferences });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-preferences:
 *   put:
 *     tags: [Grocery Preferences]
 *     summary: Update household grocery preferences
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               certificationIds: { type: array, items: { type: string, format: uuid } }
 *               brands: { type: array, items: { type: object, properties: { name: { type: string }, priority: { type: integer } } } }
 *               mealsPerDay: { type: integer, minimum: 1, maximum: 10 }
 *               daysPerWeek: { type: integer, minimum: 1, maximum: 7 }
 *     responses:
 *       200: { description: Updated preferences }
 */
router.put(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      const parsed = updatePreferencesSchema.parse(req.body);
      const preferences = await updateGroceryPreferences(household.id, parsed);
      res.json({ preferences });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-preferences/brands:
 *   get:
 *     tags: [Grocery Preferences]
 *     summary: Search brands by name
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2 }
 *     responses:
 *       200: { description: Matching brands }
 */
router.get(
  "/brands",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = (req.query.q as string) || "";
      if (query.length < 2) {
        return res.json({ brands: [] });
      }
      const brands = await searchBrands(query);
      res.json({ brands });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
