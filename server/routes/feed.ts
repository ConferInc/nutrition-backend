import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { getPersonalizedFeedWithRAG, getFeedRecommendationsWithRAG } from "../services/feed.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";

const router = Router();

/**
 * @openapi
 * /feed:
 *   get:
 *     tags: [Feed]
 *     summary: Get personalized recipe feed
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *         description: Personalize for a specific household member
 *     responses:
 *       200: { description: Personalized recipe feed }
 */
router.get("/", authMiddleware, rateLimitMiddleware, async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 200;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const memberId = req.query.memberId as string | undefined;

    const b2cCustomerId = requireB2cCustomerIdFromReq(req);
    const feedResponse = await getPersonalizedFeedWithRAG(b2cCustomerId, limit, offset, memberId);
    res.json({ recipes: feedResponse.recipes, source: feedResponse.source });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /feed/recommendations:
 *   get:
 *     tags: [Feed]
 *     summary: Get AI-powered recipe recommendations
 *     parameters:
 *       - in: query
 *         name: memberId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Recommended recipes }
 */
router.get("/recommendations", authMiddleware, rateLimitMiddleware, async (req, res, next) => {
  try {
    const b2cCustomerId = requireB2cCustomerIdFromReq(req);
    const memberId = req.query.memberId as string | undefined;
    const recommendations = await getFeedRecommendationsWithRAG(b2cCustomerId, memberId);
    res.json(recommendations);
  } catch (error) {
    next(error);
  }
});

export default router;
