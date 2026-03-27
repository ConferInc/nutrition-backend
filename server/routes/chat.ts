import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { processMessage, getRecentSessions } from "../services/chatbot.js";
import { trackFeature } from "../services/featureTracking.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
    return requireB2cCustomerIdFromReq(req);
}

const chatMessageSchema = z.object({
    message: z.string().min(1).max(500),
    sessionId: z.string().uuid().optional(),
    memberId: z.string().uuid().optional(),
});

/**
 * @openapi
 * /chat:
 *   post:
 *     tags: [Chat]
 *     summary: Send a chat message to the AI nutrition assistant
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, minLength: 1, maxLength: 500 }
 *               sessionId: { type: string, format: uuid }
 *               memberId: { type: string, format: uuid }
 *     responses:
 *       200: { description: AI response }
 *       401: { description: Unauthorized }
 */
router.post(
    "/",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const { message, sessionId, memberId } = chatMessageSchema.parse(req.body);
            const response = await processMessage(customerId, message.trim(), sessionId, memberId);
            trackFeature(customerId, "chatbot", "message");
            res.json(response);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * @openapi
 * /chat/history:
 *   get:
 *     tags: [Chat]
 *     summary: Get recent chat sessions
 *     responses:
 *       200: { description: List of recent chat sessions }
 */
router.get(
    "/history",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const sessions = await getRecentSessions(customerId, 10);
            res.json({ sessions });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
