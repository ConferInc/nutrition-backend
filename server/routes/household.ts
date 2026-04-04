import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { AppError } from "../middleware/errorHandler.js";
import { requireHouseholdRole, requireProfileEditAccess } from "../middleware/householdPermission.js";
import {
  getOrCreateHousehold,
  getHouseholdMembers,
  addFamilyMember,
  getMemberDetail,
  updateMemberBasicInfo,
  updateMemberHealthProfile,
  deleteFamilyMember,
} from "../services/household.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

// ── Validation Schemas ──────────────────────────────────────────────────────

const addMemberSchema = z.object({
  fullName: z.string().min(1).max(255),
  firstName: z.string().max(100).optional(),
  email: z.string().email().max(255).optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  age: z.number().int().min(0).max(120).optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  householdRole: z.enum(["primary_adult", "secondary_adult", "child", "dependent"]).optional(),
});

const updateMemberSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  firstName: z.string().max(100).optional(),
  email: z.string().email().max(255).optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  age: z.number().int().min(0).max(120).optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  householdRole: z.enum(["primary_adult", "secondary_adult", "child", "dependent"]).optional(),
});

const updateHealthSchema = z.object({
  targetCalories: z.number().int().positive().optional(),
  targetProteinG: z.number().positive().optional(),
  targetCarbsG: z.number().positive().optional(),
  targetFatG: z.number().positive().optional(),
  targetFiberG: z.number().positive().optional(),
  targetSodiumMg: z.number().int().positive().optional(),
  targetSugarG: z.number().positive().optional(),
  healthGoal: z.string().max(100).optional().nullable(),
  dislikedIngredients: z.array(z.string()).optional(),
  allergenIds: z.array(z.string().uuid()).optional(),
  dietIds: z.array(z.string().uuid()).optional(),
  conditionIds: z.array(z.string().uuid()).optional(),
  cuisineIds: z.array(z.string().uuid()).optional(),
});

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /households/members:
 *   get:
 *     tags: [Household]
 *     summary: List household members
 *     responses:
 *       200:
 *         description: Household info and member list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 household: { type: object }
 *                 members: { type: array, items: { type: object } }
 */
router.get(
  "/members",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      const members = await getHouseholdMembers(household.id);
      res.json({ household, members });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /households/members:
 *   post:
 *     tags: [Household]
 *     summary: Add a family member
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName]
 *             properties:
 *               fullName: { type: string, maxLength: 255 }
 *               firstName: { type: string, maxLength: 100 }
 *               email: { type: string, format: email }
 *               dateOfBirth: { type: string, format: date }
 *               age: { type: integer, minimum: 0, maximum: 120 }
 *               gender: { type: string, enum: [male, female, other, prefer_not_to_say] }
 *               householdRole: { type: string, enum: [primary_adult, secondary_adult, child, dependent] }
 *     responses:
 *       201: { description: Member added }
 */
router.post(
  "/members",
  rateLimitMiddleware,
  requireHouseholdRole("primary_adult"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      const parsed = addMemberSchema.parse(req.body);
      const member = await addFamilyMember(household.id, parsed);
      res.status(201).json({ member });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /households/members/{id}:
 *   get:
 *     tags: [Household]
 *     summary: Get member detail
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Member detail }
 *       404: { description: Member not found }
 */
router.get(
  "/members/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const member = await getMemberDetail(req.params.id);
      if (!member) {
        throw new AppError(404, "Not Found", "Household member not found");
      }
      res.json({ member });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /households/members/{id}:
 *   patch:
 *     tags: [Household]
 *     summary: Update member basic info
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
 *               fullName: { type: string }
 *               firstName: { type: string }
 *               email: { type: string, format: email }
 *               dateOfBirth: { type: string, format: date }
 *               age: { type: integer }
 *               gender: { type: string }
 *               householdRole: { type: string }
 *     responses:
 *       200: { description: Member updated }
 *       404: { description: Member not found }
 */
router.patch(
  "/members/:id",
  rateLimitMiddleware,
  requireProfileEditAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateMemberSchema.parse(req.body);
      const updated = await updateMemberBasicInfo(req.params.id, parsed);
      if (!updated) {
        throw new AppError(404, "Not Found", "Member not found or no changes");
      }
      res.json({ member: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /households/members/{id}/health:
 *   patch:
 *     tags: [Household]
 *     summary: Update member health profile
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
 *               targetCalories: { type: integer }
 *               targetProteinG: { type: number }
 *               targetCarbsG: { type: number }
 *               targetFatG: { type: number }
 *               healthGoal: { type: string }
 *               allergenIds: { type: array, items: { type: string, format: uuid } }
 *               dietIds: { type: array, items: { type: string, format: uuid } }
 *               conditionIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Health profile updated }
 */
router.patch(
  "/members/:id/health",
  rateLimitMiddleware,
  requireProfileEditAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateHealthSchema.parse(req.body);
      const member = await updateMemberHealthProfile(req.params.id, parsed);
      res.json({ member });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /households/members/{id}:
 *   delete:
 *     tags: [Household]
 *     summary: Delete a family member
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Member deleted }
 */
router.delete(
  "/members/:id",
  rateLimitMiddleware,
  requireHouseholdRole("primary_adult"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const household = await getOrCreateHousehold(customerId);
      await deleteFamilyMember(req.params.id, household.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
