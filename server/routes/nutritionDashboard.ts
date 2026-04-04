import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import {
  getHouseholdTimezone,
  getNutritionDashboardDaily,
  getNutritionDashboardMonthly,
  getNutritionDashboardRange,
  getNutritionDashboardWeekly,
  getNutritionHealthMetrics,
  getNutritionMemberSummary,
} from "../services/nutritionDashboard.js";

const router = Router();
router.use(authMiddleware);

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const dailyQuerySchema = z.object({
  date: z.string().regex(isoDateRegex).optional(),
  memberId: z.string().uuid().optional(),
});

const weeklyQuerySchema = z.object({
  weekStart: z.string().regex(isoDateRegex).optional(),
  memberId: z.string().uuid().optional(),
});

const memberSummaryQuerySchema = z.object({
  date: z.string().regex(isoDateRegex).optional(),
});

const healthMetricsQuerySchema = z.object({
  memberId: z.string().uuid().optional(),
});

const monthlyQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  memberId: z.string().uuid().optional(),
});

const rangeQuerySchema = z.object({
  startDate: z.string().regex(isoDateRegex),
  endDate: z.string().regex(isoDateRegex),
  memberId: z.string().uuid().optional(),
});

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

function normalizeTimeZone(tz: string): string {
  const value = (tz || "").trim();
  if (!value) return "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return "UTC";
  }
}

function ymdInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const mapped = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day}`;
}

function toWeekStartMonday(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const diff = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * @openapi
 * /nutrition/daily:
 *   get:
 *     tags: [Nutrition Dashboard]
 *     summary: Daily nutrition summary
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Daily nutrition totals vs targets }
 */
router.get(
  "/daily",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorMemberId = b2cId(req);
      const parsed = dailyQuerySchema.parse(req.query ?? {});
      const timezone = normalizeTimeZone(await getHouseholdTimezone(actorMemberId));
      const date = parsed.date ?? ymdInTimeZone(timezone);
      const data = await getNutritionDashboardDaily({
        actorMemberId,
        memberId: parsed.memberId,
        date,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /nutrition/weekly:
 *   get:
 *     tags: [Nutrition Dashboard]
 *     summary: Weekly nutrition summary
 *     parameters:
 *       - in: query
 *         name: weekStart
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Weekly nutrition trends }
 */
router.get(
  "/weekly",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorMemberId = b2cId(req);
      const parsed = weeklyQuerySchema.parse(req.query ?? {});
      const timezone = normalizeTimeZone(await getHouseholdTimezone(actorMemberId));
      const baseDate = parsed.weekStart ?? ymdInTimeZone(timezone);
      const weekStart = parsed.weekStart ?? toWeekStartMonday(baseDate);
      const data = await getNutritionDashboardWeekly({
        actorMemberId,
        memberId: parsed.memberId,
        weekStart,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /nutrition/monthly:
 *   get:
 *     tags: [Nutrition Dashboard]
 *     summary: Monthly nutrition summary
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: string, pattern: '^\d{4}-(0[1-9]|1[0-2])$' }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Monthly nutrition data }
 */
router.get(
  "/monthly",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorMemberId = b2cId(req);
      const parsed = monthlyQuerySchema.parse(req.query ?? {});
      const data = await getNutritionDashboardMonthly({
        actorMemberId,
        memberId: parsed.memberId,
        month: parsed.month,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /nutrition/range:
 *   get:
 *     tags: [Nutrition Dashboard]
 *     summary: Nutrition data over custom date range
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
 *       200: { description: Custom range nutrition data }
 */
router.get(
  "/range",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorMemberId = b2cId(req);
      const parsed = rangeQuerySchema.parse(req.query ?? {});
      const data = await getNutritionDashboardRange({
        actorMemberId,
        memberId: parsed.memberId,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /nutrition/member-summary:
 *   get:
 *     tags: [Nutrition Dashboard]
 *     summary: Summary across all household members
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Nutrition summary per member }
 */
router.get(
  "/member-summary",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorMemberId = b2cId(req);
      const parsed = memberSummaryQuerySchema.parse(req.query ?? {});
      const timezone = normalizeTimeZone(await getHouseholdTimezone(actorMemberId));
      const date = parsed.date ?? ymdInTimeZone(timezone);
      const data = await getNutritionMemberSummary({
        actorMemberId,
        date,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /nutrition/health-metrics:
 *   get:
 *     tags: [Nutrition Dashboard]
 *     summary: Health metrics overview
 *     parameters:
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Health metrics and trends }
 */
router.get(
  "/health-metrics",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorMemberId = b2cId(req);
      const parsed = healthMetricsQuerySchema.parse(req.query ?? {});
      const data = await getNutritionHealthMetrics({
        actorMemberId,
        memberId: parsed.memberId,
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

