import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import {
  createOrReplaceActiveBudget,
  getBudgetRecommendations,
  getBudgetSnapshot,
  getBudgetTrends,
  updateBudget,
} from "../services/budget.js";

const router = Router();
router.use(authMiddleware);

const periodEnum = z.enum(["weekly", "monthly"]);
const budgetTypeEnum = z.enum(["grocery"]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

const snapshotQuerySchema = z.object({
  period: periodEnum.default("weekly"),
  budgetType: budgetTypeEnum.default("grocery"),
});

const createBudgetSchema = z.object({
  amount: z.number().positive(),
  period: periodEnum,
  budgetType: budgetTypeEnum.default("grocery"),
  currency: z.literal("USD").optional(),
  startDate: z.string().regex(isoDate).optional().nullable(),
  endDate: z.string().regex(isoDate).optional().nullable(),
});

const updateBudgetSchema = z
  .object({
    amount: z.number().positive().optional(),
    period: periodEnum.optional(),
    startDate: z.string().regex(isoDate).optional().nullable(),
    endDate: z.string().regex(isoDate).optional().nullable(),
  })
  .refine(
    (data) =>
      data.amount !== undefined ||
      data.period !== undefined ||
      data.startDate !== undefined ||
      data.endDate !== undefined,
    { message: "At least one field is required" }
  );

const trendsQuerySchema = z.object({
  period: periodEnum.default("weekly"),
  budgetType: budgetTypeEnum.default("grocery"),
  points: z.coerce.number().int().min(1).max(52).default(12),
});

const recommendationsQuerySchema = z.object({
  period: periodEnum.default("weekly"),
  budgetType: budgetTypeEnum.default("grocery"),
});

/**
 * @openapi
 * /budgets:
 *   get:
 *     tags: [Budget]
 *     summary: Get budget snapshot
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [weekly, monthly], default: weekly }
 *       - in: query
 *         name: budgetType
 *         schema: { type: string, enum: [grocery], default: grocery }
 *     responses:
 *       200: { description: Current budget status }
 */
router.get(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = snapshotQuerySchema.parse(req.query ?? {});
      const result = await getBudgetSnapshot(customerId, parsed);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /budgets:
 *   post:
 *     tags: [Budget]
 *     summary: Create or replace active budget
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, period]
 *             properties:
 *               amount: { type: number }
 *               period: { type: string, enum: [weekly, monthly] }
 *               budgetType: { type: string, default: grocery }
 *               currency: { type: string, default: USD }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *     responses:
 *       201: { description: Budget created }
 */
router.post(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = createBudgetSchema.parse(req.body ?? {});
      const result = await createOrReplaceActiveBudget(customerId, parsed);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /budgets/trends:
 *   get:
 *     tags: [Budget]
 *     summary: Get budget spending trends
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [weekly, monthly] }
 *       - in: query
 *         name: budgetType
 *         schema: { type: string, enum: [grocery] }
 *       - in: query
 *         name: points
 *         schema: { type: integer, default: 12, maximum: 52 }
 *     responses:
 *       200: { description: Spending trend data }
 */
router.get(
  "/trends",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = trendsQuerySchema.parse(req.query ?? {});
      const result = await getBudgetTrends(customerId, parsed);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /budgets/recommendations:
 *   get:
 *     tags: [Budget]
 *     summary: Get budget recommendations
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [weekly, monthly] }
 *       - in: query
 *         name: budgetType
 *         schema: { type: string, enum: [grocery] }
 *     responses:
 *       200: { description: Budget optimization recommendations }
 */
router.get(
  "/recommendations",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = recommendationsQuerySchema.parse(req.query ?? {});
      const result = await getBudgetRecommendations(customerId, parsed);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /budgets/{id}:
 *   put:
 *     tags: [Budget]
 *     summary: Update a budget
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
 *             properties:
 *               amount: { type: number }
 *               period: { type: string, enum: [weekly, monthly] }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *     responses:
 *       200: { description: Budget updated }
 */
router.put(
  "/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = updateBudgetSchema.parse(req.body ?? {});
      const result = await updateBudget(customerId, req.params.id, parsed);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
