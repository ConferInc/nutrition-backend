import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import {
  lookupProductByBarcode,
  saveScanHistory,
  getScanHistory,
} from "../services/scan.js";
import { trackFeature } from "../services/featureTracking.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

const lookupSchema = z.object({
  barcode: z.string().min(1).max(50),
  memberId: z.string().uuid().optional(),
});

const saveHistorySchema = z.object({
  barcode: z.string().min(1).max(50),
  productId: z.string().uuid().optional(),
  barcodeFormat: z.string().max(30).optional(),
  scanSource: z.string().max(30).optional(),
});

/**
 * @openapi
 * /scan/lookup:
 *   post:
 *     tags: [Scan]
 *     summary: Look up a product by barcode
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode]
 *             properties:
 *               barcode: { type: string, minLength: 1, maxLength: 50 }
 *               memberId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Product data }
 *       404: { description: Product not found }
 */
router.post(
  "/lookup",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { barcode, memberId } = lookupSchema.parse(req.body);
      const result = await lookupProductByBarcode(barcode, customerId, memberId);
      trackFeature(customerId, "scan", "lookup");
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /scan/history:
 *   post:
 *     tags: [Scan]
 *     summary: Save a barcode scan to history
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode]
 *             properties:
 *               barcode: { type: string }
 *               productName: { type: string }
 *               productData: { type: object }
 *     responses:
 *       201: { description: Scan saved }
 */
router.post(
  "/history",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const parsed = saveHistorySchema.parse(req.body);
      const result = await saveScanHistory({
        b2cCustomerId: customerId,
        barcode: parsed.barcode,
        productId: parsed.productId,
        barcodeFormat: parsed.barcodeFormat,
        scanSource: parsed.scanSource,
      });
      trackFeature(customerId, "scan", "save_history");
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /scan/history:
 *   get:
 *     tags: [Scan]
 *     summary: Get scan history
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200: { description: Paginated scan history }
 */
router.get(
  "/history",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const history = await getScanHistory(customerId, limit, offset);
      res.json(history);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
