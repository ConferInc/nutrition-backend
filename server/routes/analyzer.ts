import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import {
  analyzeText,
  analyzeUrl,
  analyzeImage,
  analyzeBarcode,
  saveAnalyzedRecipe,
} from "../services/analyzer.js";
import { trackFeature } from "../services/featureTracking.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

// Validation schemas
const textSchema = z.object({
  text: z.string().min(1).max(5000),
});

const urlSchema = z.object({
  url: z.string().url().max(2000),
});

const barcodeSchema = z.object({
  barcode: z.string().min(1).max(50),
});

/**
 * @openapi
 * /analyzer/text:
 *   post:
 *     tags: [Analyzer]
 *     summary: Analyze recipe from plain text
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, minLength: 1, maxLength: 5000 }
 *     responses:
 *       200: { description: Analyzed recipe data }
 */
router.post(
  "/text",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { text } = textSchema.parse(req.body);
      const result = await analyzeText(text);
      trackFeature(customerId, "analyzer", "text");
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /analyzer/url:
 *   post:
 *     tags: [Analyzer]
 *     summary: Analyze recipe from URL
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url: { type: string, format: uri, maxLength: 2000 }
 *     responses:
 *       200: { description: Analyzed recipe data }
 */
router.post(
  "/url",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { url } = urlSchema.parse(req.body);
      const result = await analyzeUrl(url);
      trackFeature(customerId, "analyzer", "url");
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /analyzer/image:
 *   post:
 *     tags: [Analyzer]
 *     summary: Analyze recipe from image
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200: { description: Analyzed recipe data }
 */
router.post(
  "/image",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const result = await analyzeImage(req);
      trackFeature(customerId, "analyzer", "image");
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /analyzer/barcode:
 *   post:
 *     tags: [Analyzer]
 *     summary: Analyze product from barcode
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode]
 *             properties:
 *               barcode: { type: string, minLength: 1, maxLength: 50 }
 *     responses:
 *       200: { description: Analyzed product data }
 */
router.post(
  "/barcode",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const { barcode } = barcodeSchema.parse(req.body);
      const result = await analyzeBarcode(barcode);
      trackFeature(customerId, "analyzer", "barcode");
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @openapi
 * /analyzer/save:
 *   post:
 *     tags: [Analyzer]
 *     summary: Save an analyzed recipe to the gold schema
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Full analyzed recipe payload
 *     responses:
 *       201: { description: Recipe saved }
 */
router.post(
  "/save",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      const result = await saveAnalyzedRecipe(customerId, req.body);
      trackFeature(customerId, "analyzer", "save");
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
