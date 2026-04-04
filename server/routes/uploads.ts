import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { uploadRecipeImage, deleteRecipeImage } from "../services/imageUpload.js";
import { randomUUID } from "node:crypto";
import multer from "multer";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/webp"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPEG, PNG, and WebP images are allowed"));
        }
    },
});

const router = Router();

/**
 * @openapi
 * /uploads/recipe-image:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload a recipe cover image
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary, description: JPEG/PNG/WebP max 5MB }
 *               recipeId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Image uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string, format: uri }
 *                 recipeId: { type: string, format: uuid }
 *       400: { description: No file uploaded or invalid format }
 */
router.post(
    "/recipe-image",
    authMiddleware,
    upload.single("file"),
    async (req, res, next) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            const b2cCustomerId = requireB2cCustomerIdFromReq(req);
            const recipeId = req.body?.recipeId || randomUUID();

            const url = await uploadRecipeImage(
                req.file.buffer,
                req.file.mimetype,
                b2cCustomerId,
                recipeId,
            );

            res.json({ url, recipeId });
        } catch (err) {
            next(err);
        }
    },
);

/**
 * @openapi
 * /uploads/recipe-image/{recipeId}:
 *   delete:
 *     tags: [Uploads]
 *     summary: Delete a recipe image
 *     parameters:
 *       - in: path
 *         name: recipeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Image deleted }
 */
router.delete(
    "/recipe-image/:recipeId",
    authMiddleware,
    async (req, res, next) => {
        try {
            const b2cCustomerId = requireB2cCustomerIdFromReq(req);
            await deleteRecipeImage(b2cCustomerId, req.params.recipeId);
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    },
);

export default router;
