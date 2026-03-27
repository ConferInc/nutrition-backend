import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import {
  addGroceryListItem,
  deleteGroceryListItem,
  generateGroceryList,
  getGroceryItemSubstitutions,
  getGroceryListDetail,
  listGroceryLists,
  updateGroceryListStatus,
  updateGroceryListItem,
} from "../services/groceryList.js";
import { trackFeature } from "../services/featureTracking.js";
import { exportGroceryListAsCsv } from "../services/groceryExport.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

const statusEnum = z.enum(["draft", "active", "purchased", "archived"]);

const generateSchema = z.object({
  mealPlanId: z.string().uuid().optional(),
});

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const updateItemSchema = z
  .object({
    isPurchased: z.boolean().optional(),
    actualPrice: z.number().min(0).optional(),
    substitutedProductId: z.string().uuid().optional(),
  })
  .refine(
    (data) =>
      data.isPurchased !== undefined ||
      data.actualPrice !== undefined ||
      data.substitutedProductId !== undefined,
    { message: "At least one field is required" }
  );

const addItemSchema = z.object({
  itemName: z.string().min(1).max(255),
  quantity: z.number().positive(),
  unit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  estimatedPrice: z.number().min(0).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["active", "purchased"]),
});

/**
 * @openapi
 * /grocery-lists/generate:
 *   post:
 *     tags: [Grocery Lists]
 *     summary: Generate a grocery list from meal plan
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mealPlanId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Grocery list generated }
 */
router.post(
  "/generate",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = generateSchema.parse(req.body ?? {});
      const result = await generateGroceryList(customerId, parsed);
      trackFeature(customerId, "grocery_list", "generate");
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists:
 *   get:
 *     tags: [Grocery Lists]
 *     summary: List grocery lists
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, active, purchased, archived] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200: { description: Paginated grocery lists }
 */
router.get(
  "/",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = listQuerySchema.parse(req.query ?? {});
      const result = await listGroceryLists(
        customerId,
        parsed.status,
        parsed.limit ?? 20,
        parsed.offset ?? 0
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists/{id}:
 *   get:
 *     tags: [Grocery Lists]
 *     summary: Get grocery list detail
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Full grocery list with items }
 */
router.get(
  "/:id",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const result = await getGroceryListDetail(customerId, req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists/{id}/status:
 *   put:
 *     tags: [Grocery Lists]
 *     summary: Update grocery list status
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [active, purchased] }
 *     responses:
 *       200: { description: Status updated }
 */
router.put(
  "/:id/status",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = updateStatusSchema.parse(req.body ?? {});
      const result = await updateGroceryListStatus(customerId, req.params.id, parsed.status);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists/{id}/items/{itemId}:
 *   put:
 *     tags: [Grocery Lists]
 *     summary: Update a grocery list item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isPurchased: { type: boolean }
 *               actualPrice: { type: number }
 *               substitutedProductId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Item updated }
 */
router.put(
  "/:id/items/:itemId",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = updateItemSchema.parse(req.body ?? {});
      const result = await updateGroceryListItem(customerId, req.params.id, req.params.itemId, parsed);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists/{id}/items:
 *   post:
 *     tags: [Grocery Lists]
 *     summary: Add item to grocery list
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
 *             required: [itemName, quantity]
 *             properties:
 *               itemName: { type: string }
 *               quantity: { type: number }
 *               unit: { type: string }
 *               category: { type: string }
 *               estimatedPrice: { type: number }
 *     responses:
 *       201: { description: Item added }
 */
router.post(
  "/:id/items",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = addItemSchema.parse(req.body ?? {}) as {
        itemName: string;
        quantity: number;
        unit?: string;
        category?: string;
        estimatedPrice?: number;
      };
      const result = await addGroceryListItem(customerId, req.params.id, parsed);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists/{id}/export:
 *   get:
 *     tags: [Grocery Lists]
 *     summary: Export grocery list as CSV
 *     description: Downloads the grocery list as a CSV file.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema: { type: string }
 */
router.get(
  "/:id/export",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { csv, filename } = await exportGroceryListAsCsv(
        customerId,
        req.params.id
      );
      trackFeature(customerId, "grocery_list", "export_csv");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(csv);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists/{id}/items/{itemId}:
 *   delete:
 *     tags: [Grocery Lists]
 *     summary: Delete an item from grocery list
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
      const customerId = b2cId(req);
      const result = await deleteGroceryListItem(customerId, req.params.id, req.params.itemId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /grocery-lists/{id}/items/{itemId}/substitutions:
 *   get:
 *     tags: [Grocery Lists]
 *     summary: Get substitutions for a grocery item
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
 *       200: { description: Available substitutions }
 */
router.get(
  "/:id/items/:itemId/substitutions",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const result = await getGroceryItemSubstitutions(customerId, req.params.id, req.params.itemId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

