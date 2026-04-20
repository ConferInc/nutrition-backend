import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import multer from "multer";
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

// Multer config for image upload — matches pattern in uploads.ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) { cb(null, true); } else { cb(new Error("Only JPEG, PNG, and WebP images are allowed")); }
  },
});

function b2cId(req: Request): string {
  return requireB2cCustomerIdFromReq(req);
}

// Validation schemas
const textSchema = z.object({
  text: z.string().min(1).max(5000),
  memberId: z.string().uuid().optional(),
});

const urlSchema = z.object({
  url: z.string().url().max(2000),
  memberId: z.string().uuid().optional(),
});

const barcodeSchema = z.object({
  barcode: z.string().min(1).max(50),
  memberId: z.string().uuid().optional(),
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
      const { text, memberId } = textSchema.parse(req.body);
      const result = await analyzeText(text, customerId, memberId);
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
      const { url, memberId } = urlSchema.parse(req.body);
      const result = await analyzeUrl(url, customerId, memberId);
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
  upload.single("image"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = b2cId(req);
      if (!req.file) {
        return res.status(400).json({ error: "No image file uploaded" });
      }
      const memberId = req.body?.memberId;
      const result = await analyzeImage(req.file.buffer, customerId, memberId);
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
      const { barcode, memberId } = barcodeSchema.parse(req.body);
      const result = await analyzeBarcode(barcode, customerId, memberId);
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
      const result = await saveAnalyzedRecipe(req.body, customerId);
      trackFeature(customerId, "analyzer", "save");
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
