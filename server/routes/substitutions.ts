import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import {
    getIngredientSubstitutions,
    getProductSubstitutions,
} from "../services/substitutions.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
    return requireB2cCustomerIdFromReq(req);
}

const memberQuerySchema = z.object({
    memberId: z.string().uuid().optional(),
});

/**
 * @openapi
 * /substitutions/ingredient/{ingredientId}:
 *   get:
 *     tags: [Substitutions]
 *     summary: Get substitutions for an ingredient
 *     parameters:
 *       - in: path
 *         name: ingredientId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of ingredient substitutions }
 */
router.get(
    "/ingredient/:ingredientId",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const { ingredientId } = req.params;
            const { memberId } = memberQuerySchema.parse(req.query ?? {});
            const result = await getIngredientSubstitutions(customerId, ingredientId, memberId);
            res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * @openapi
 * /substitutions/product/{productId}:
 *   get:
 *     tags: [Substitutions]
 *     summary: Get substitutions for a product
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of product substitutions }
 */
router.get(
    "/product/:productId",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const { productId } = req.params;
            const { memberId } = memberQuerySchema.parse(req.query ?? {});
            const result = await getProductSubstitutions(customerId, productId, memberId);
            res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

export default router;
