import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { AppError } from "../middleware/errorHandler.js";
import { auditLogEntry } from "../middleware/audit.js";
import { trackFeature } from "../services/featureTracking.js";
import {
  getDailyLog,
  addMealItem,
  updateMealItem,
  deleteMealItem,
  updateWaterIntake,
  copyDay,
  getHistory,
  getStreak,
  logFromCooking,
  getTemplates,
  createTemplate,
  getMealPatterns,
} from "../services/mealLog.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

const mealTypeEnum = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// ── Validation Schemas ──────────────────────────────────────────────────────

const addItemSchema = z.object({
  date: z.string().regex(dateRegex, "Date must be YYYY-MM-DD"),
  memberId: z.string().uuid().optional(),
  mealType: mealTypeEnum,
  recipeId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  customName: z.string().max(500).optional(),
  customBrand: z.string().max(255).optional(),
  servings: z.number().positive().default(1),
  servingSize: z.string().max(100).optional(),
  servingSizeG: z.number().positive().optional(),
  source: z.enum(["manual", "recipe", "scan", "quick_add", "copy", "cooking_mode"]).optional(),
  notes: z.string().optional(),
  imageUrl: z.string().url().max(1000).optional(),
  nutrition: z
    .object({
      calories: z.number().optional(),
      proteinG: z.number().optional(),
      carbsG: z.number().optional(),
      fatG: z.number().optional(),
      fiberG: z.number().optional(),
      sugarG: z.number().optional(),
      sodiumMg: z.number().optional(),
      saturatedFatG: z.number().optional(),
    })
    .optional(),
}).refine(
  (d) => d.recipeId || d.productId || d.customName,
  { message: "One of recipeId, productId, or customName is required" }
);

const updateItemSchema = z.object({
  servings: z.number().positive().optional(),
  mealType: mealTypeEnum.optional(),
  notes: z.string().optional(),
}).refine(
  (d) => d.servings != null || d.mealType != null || d.notes != null,
  { message: "At least one field is required" }
);

const waterSchema = z.object({
  date: z.string().regex(dateRegex),
  memberId: z.string().uuid().optional(),
  amount_ml: z.number().int().positive(),
});

const copyDaySchema = z.object({
  sourceDate: z.string().regex(dateRegex),
  targetDate: z.string().regex(dateRegex),
  memberId: z.string().uuid().optional(),
}).refine((d) => d.sourceDate !== d.targetDate, {
  message: "sourceDate and targetDate must be different",
});

const cookingLogSchema = z.object({
  recipeId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  servings: z.number().positive().default(1),
  mealType: mealTypeEnum.optional(),
  cookingStartedAt: z.string(),
  cookingFinishedAt: z.string(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(255),
  memberId: z.string().uuid().optional(),
  mealType: mealTypeEnum.optional(),
  items: z.array(z.any()).min(1),
});

const memberQuerySchema = z.object({
  memberId: z.string().uuid().optional(),
});

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /meal-log:
 *   get:
 *     tags: [Meal Log]
 *     summary: Get daily meal log
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Defaults to today
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Daily log with meals and nutrition totals }
 */
// GET /api/v1/meal-log?date=YYYY-MM-DD&memberId=xxx
router.get(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);

      if (!dateRegex.test(date)) {
        throw new AppError(400, "Bad Request", "date must be YYYY-MM-DD");
      }

      const { memberId } = memberQuerySchema.parse(req.query ?? {});
      const result = await getDailyLog(customerId, date, memberId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/items:
 *   post:
 *     tags: [Meal Log]
 *     summary: Add a meal item
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, mealType]
 *             properties:
 *               date: { type: string, format: date }
 *               memberId: { type: string, format: uuid }
 *               mealType: { type: string, enum: [breakfast, lunch, dinner, snack] }
 *               recipeId: { type: string, format: uuid }
 *               productId: { type: string, format: uuid }
 *               customName: { type: string }
 *               servings: { type: number, default: 1 }
 *               source: { type: string, enum: [manual, recipe, scan, quick_add, copy, cooking_mode] }
 *               nutrition: { type: object }
 *     responses:
 *       201: { description: Item added }
 */
// POST /api/v1/meal-log/items
router.post(
  "/items",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = addItemSchema.parse(req.body);
      const result = await addMealItem(customerId, parsed);
      trackFeature(customerId, "meal_log", "add_item", { source: parsed.source });

      // ── HIPAA Audit: dietary intake logging ──
      void auditLogEntry(
        (req as any).user?.userId, "post_/meal-log/items",
        "meal_log_items", (result as any)?.id ?? customerId, null, null,
        undefined, req.ip, req.headers["user-agent"] as string | undefined
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/items/{id}:
 *   put:
 *     tags: [Meal Log]
 *     summary: Update a meal item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               servings: { type: number }
 *               mealType: { type: string }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Item updated }
 */
// PUT /api/v1/meal-log/items/:id
router.put(
  "/items/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = updateItemSchema.parse(req.body);
      const { memberId } = memberQuerySchema.parse(req.query ?? {});
      const result = await updateMealItem(req.params.id, customerId, parsed, memberId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/items/{id}:
 *   delete:
 *     tags: [Meal Log]
 *     summary: Delete a meal item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Item deleted }
 */
// DELETE /api/v1/meal-log/items/:id
router.delete(
  "/items/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { memberId } = memberQuerySchema.parse(req.query ?? {});
      const result = await deleteMealItem(req.params.id, customerId, memberId);

      // ── HIPAA Audit: dietary data removal ──
      void auditLogEntry(
        (req as any).user?.userId, "delete_/meal-log/items/:id",
        "meal_log_items", req.params.id, null, null,
        undefined, req.ip, req.headers["user-agent"] as string | undefined
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/water:
 *   post:
 *     tags: [Meal Log]
 *     summary: Update water intake
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, amount_ml]
 *             properties:
 *               date: { type: string, format: date }
 *               memberId: { type: string, format: uuid }
 *               amount_ml: { type: integer }
 *     responses:
 *       200: { description: Water intake updated }
 */
// POST /api/v1/meal-log/water
router.post(
  "/water",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = waterSchema.parse(req.body);
      const result = await updateWaterIntake(customerId, parsed.date, parsed.amount_ml, parsed.memberId);
      trackFeature(customerId, "meal_log", "water", { amount_ml: parsed.amount_ml });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/copy-day:
 *   post:
 *     tags: [Meal Log]
 *     summary: Copy meals from one day to another
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceDate, targetDate]
 *             properties:
 *               sourceDate: { type: string, format: date }
 *               targetDate: { type: string, format: date }
 *               memberId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Day copied }
 */
// POST /api/v1/meal-log/copy-day
router.post(
  "/copy-day",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = copyDaySchema.parse(req.body);
      const result = await copyDay(customerId, parsed.sourceDate, parsed.targetDate, parsed.memberId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/history:
 *   get:
 *     tags: [Meal Log]
 *     summary: Get meal log history over a date range
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Daily summaries }
 */
// GET /api/v1/meal-log/history?startDate=...&endDate=...&memberId=xxx
router.get(
  "/history",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : "";

      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        throw new AppError(400, "Bad Request", "startDate and endDate must be YYYY-MM-DD");
      }

      const { memberId } = memberQuerySchema.parse(req.query ?? {});
      const result = await getHistory(customerId, startDate, endDate, memberId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/streak:
 *   get:
 *     tags: [Meal Log]
 *     summary: Get current logging streak
 *     parameters:
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Streak count }
 */
// GET /api/v1/meal-log/streak?memberId=xxx
router.get(
  "/streak",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { memberId } = memberQuerySchema.parse(req.query ?? {});
      const streak = await getStreak(customerId, memberId);
      res.json(streak);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/from-cooking:
 *   post:
 *     tags: [Meal Log]
 *     summary: Log a meal from cooking mode
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipeId, cookingStartedAt, cookingFinishedAt]
 *             properties:
 *               recipeId: { type: string, format: uuid }
 *               memberId: { type: string, format: uuid }
 *               servings: { type: number, default: 1 }
 *               mealType: { type: string }
 *               cookingStartedAt: { type: string, format: date-time }
 *               cookingFinishedAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: Meal logged from cooking }
 */
// POST /api/v1/meal-log/from-cooking
router.post(
  "/from-cooking",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = cookingLogSchema.parse(req.body);
      const result = await logFromCooking(customerId, parsed);
      trackFeature(customerId, "meal_log", "from_cooking");
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/templates:
 *   get:
 *     tags: [Meal Log]
 *     summary: Get meal templates
 *     parameters:
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of templates }
 */
// GET /api/v1/meal-log/templates?memberId=xxx
router.get(
  "/templates",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { memberId } = memberQuerySchema.parse(req.query ?? {});
      const templates = await getTemplates(customerId, memberId);
      res.json({ templates });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/templates:
 *   post:
 *     tags: [Meal Log]
 *     summary: Create a meal template
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, items]
 *             properties:
 *               name: { type: string, maxLength: 255 }
 *               memberId: { type: string, format: uuid }
 *               mealType: { type: string }
 *               items: { type: array, items: { type: object }, minItems: 1 }
 *     responses:
 *       201: { description: Template created }
 */
// POST /api/v1/meal-log/templates
router.post(
  "/templates",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = templateSchema.parse(req.body);
      const template = await createTemplate(customerId, parsed);
      res.status(201).json({ template });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /meal-log/patterns:
 *   get:
 *     tags: [Meal Log]
 *     summary: Get meal patterns analysis
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 14 }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Meal pattern analysis }
 */
// GET /api/v1/meal-log/patterns?days=14&memberId=xxx (PRD-15)
router.get(
  "/patterns",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const days = parseInt(req.query.days as string) || 14;
      const { memberId } = memberQuerySchema.parse(req.query ?? {});
      const patterns = await getMealPatterns(customerId, days, memberId);
      res.json(patterns);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
