import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { AppError } from "../middleware/errorHandler.js";
import { trackFeature } from "../services/featureTracking.js";
import {
  generateMealPlan,
  listPlans,
  getPlanDetail,
  activatePlan,
  swapMeal,
  regeneratePlan,
  deletePlan,
  logMealFromPlan,
  addItemToPlan,
  reorderItems,
  deleteItemFromPlan,
} from "../services/mealPlan.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const mealTypeEnum = z.enum(["breakfast", "lunch", "dinner", "snack"]);

// ── Validation Schemas ──────────────────────────────────────────────────────

const generateSchema = z.object({
  startDate: z.string().regex(dateRegex, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(dateRegex, "endDate must be YYYY-MM-DD"),
  memberIds: z.array(z.string().uuid()).min(1, "At least one member is required"),
  budgetAmount: z.number().positive().optional(),
  budgetCurrency: z.string().length(3).optional(),
  mealsPerDay: z.array(mealTypeEnum).min(1).default(["breakfast", "lunch", "dinner"]),
  preferences: z
    .object({
      maxCookTime: z.number().int().positive().optional(),
      cuisines: z.array(z.string()).optional(),
      excludeRecipeIds: z.array(z.string().uuid()).optional(),
      prompt: z.string().max(1000).optional(),
    })
    .optional(),
});

const swapSchema = z.object({
  itemId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

const logMealSchema = z.object({
  itemId: z.string().uuid(),
});

const addItemSchema = z.object({
  recipeId: z.string().uuid(),
  mealDate: z.string().regex(dateRegex, "mealDate must be YYYY-MM-DD"),
  mealType: mealTypeEnum,
  servings: z.number().int().positive().optional(),
  replaceItemId: z.string().uuid().optional(),
});

const reorderSchema = z.object({
  moves: z.array(
    z.object({
      itemId: z.string().uuid(),
      mealDate: z.string().regex(dateRegex, "mealDate must be YYYY-MM-DD"),
      mealType: mealTypeEnum,
    })
  ).min(1),
});

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /meal-plans/generate:
 *   post:
 *     tags: [Meal Plans]
 *     summary: Generate a new meal plan
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [startDate, endDate, memberIds]
 *             properties:
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               memberIds: { type: array, items: { type: string, format: uuid } }
 *               budgetAmount: { type: number }
 *               budgetCurrency: { type: string, maxLength: 3 }
 *               mealsPerDay: { type: array, items: { type: string, enum: [breakfast, lunch, dinner, snack] } }
 *               preferences:
 *                 type: object
 *                 properties:
 *                   maxCookTime: { type: integer }
 *                   cuisines: { type: array, items: { type: string } }
 *                   excludeRecipeIds: { type: array, items: { type: string, format: uuid } }
 *                   prompt: { type: string, maxLength: 1000 }
 *     responses:
 *       201: { description: Meal plan generated }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post(
  "/generate",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = generateSchema.parse(req.body);
      const result = await generateMealPlan(customerId, parsed);
      trackFeature(customerId, "meal_plan", "generate", { mealsPerDay: parsed.mealsPerDay.length });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans:
 *   get:
 *     tags: [Meal Plans]
 *     summary: List meal plans
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Paginated list of meal plans }
 */
router.get(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const memberId = typeof req.query.memberId === "string" ? req.query.memberId : undefined;
      const result = await listPlans(customerId, status, limit, offset, memberId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}:
 *   get:
 *     tags: [Meal Plans]
 *     summary: Get meal plan detail
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Full meal plan with items }
 *       404: { description: Plan not found }
 */
router.get(
  "/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getPlanDetail(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}/activate:
 *   put:
 *     tags: [Meal Plans]
 *     summary: Activate a meal plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Plan activated }
 */
router.put(
  "/:id/activate",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const plan = await activatePlan(req.params.id, customerId);
      res.json({ plan });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}/swap-meal:
 *   post:
 *     tags: [Meal Plans]
 *     summary: Swap a meal in a plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId]
 *             properties:
 *               itemId: { type: string, format: uuid }
 *               reason: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Meal swapped }
 */
router.post(
  "/:id/swap-meal",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = swapSchema.parse(req.body);
      const result = await swapMeal(req.params.id, parsed.itemId, customerId, parsed.reason);
      trackFeature(customerId, "meal_plan", "swap");
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}/add-item:
 *   post:
 *     tags: [Meal Plans]
 *     summary: Add an item to a meal plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipeId, mealDate, mealType]
 *             properties:
 *               recipeId: { type: string, format: uuid }
 *               mealDate: { type: string, format: date }
 *               mealType: { type: string, enum: [breakfast, lunch, dinner, snack] }
 *               servings: { type: integer }
 *               replaceItemId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Item added }
 */
router.post(
  "/:id/add-item",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = addItemSchema.parse(req.body);
      const result = await addItemToPlan(req.params.id, customerId, parsed);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}/reorder:
 *   patch:
 *     tags: [Meal Plans]
 *     summary: Reorder items in a meal plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [moves]
 *             properties:
 *               moves:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     itemId: { type: string, format: uuid }
 *                     mealDate: { type: string, format: date }
 *                     mealType: { type: string, enum: [breakfast, lunch, dinner, snack] }
 *     responses:
 *       200: { description: Items reordered }
 */
router.patch(
  "/:id/reorder",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = reorderSchema.parse(req.body);
      const result = await reorderItems(req.params.id, parsed.moves);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}/items/{itemId}:
 *   delete:
 *     tags: [Meal Plans]
 *     summary: Delete an item from a meal plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Item deleted }
 */
router.delete(
  "/:id/items/:itemId",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteItemFromPlan(req.params.id, req.params.itemId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}/regenerate:
 *   post:
 *     tags: [Meal Plans]
 *     summary: Regenerate a meal plan with new recipes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Plan regenerated }
 */
router.post(
  "/:id/regenerate",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const result = await regeneratePlan(req.params.id, customerId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}:
 *   delete:
 *     tags: [Meal Plans]
 *     summary: Delete a meal plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Plan deleted }
 */
router.delete(
  "/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deletePlan(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-plans/{id}/log-meal:
 *   post:
 *     tags: [Meal Plans]
 *     summary: Log a meal from a plan item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId]
 *             properties:
 *               itemId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Meal logged }
 */
router.post(
  "/:id/log-meal",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = logMealSchema.parse(req.body);
      const result = await logMealFromPlan(req.params.id, parsed.itemId, customerId);
      trackFeature(customerId, "meal_log", "log_from_plan");
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
