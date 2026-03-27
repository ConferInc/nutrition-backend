import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { searchIngredients } from "../services/ingredientSearch.js";

const router = Router();

/**
 * @openapi
 * /ingredients/search:
 *   get:
 *     tags: [Ingredient Search]
 *     summary: Search ingredients with inline nutrition
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2 }
 *         description: Search term (min 2 chars)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 20 }
 *     responses:
 *       200: { description: Matching ingredients with nutrition per 100g }
 */
router.get("/search", authMiddleware, async (req, res, next) => {
    try {
        const q = String(req.query.q ?? "");
        const rawLimit = Number(req.query.limit ?? 10);
        const limit = Math.min(20, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10));

        if (q.trim().length < 2) {
            return res.json({ items: [] });
        }

        const items = await searchIngredients(q, limit);
        res.json({ items });
    } catch (err) {
        next(err);
    }
});

export default router;
