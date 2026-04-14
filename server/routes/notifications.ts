import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { AppError } from "../middleware/errorHandler.js";
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} from "../services/notifications.js";
import { evaluateAndDispatchNotifications } from "../services/notificationEngine.js";
import { trackFeature } from "../services/featureTracking.js";

const router = Router();
router.use(authMiddleware);

function b2cId(req: Request): string {
    return requireB2cCustomerIdFromReq(req);
}

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List notifications
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [meal, nutrition, grocery, budget, family, system] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200: { description: Paginated notifications }
 */
router.get(
    "/",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const type = req.query.type as string | undefined;
            const limit = Math.min(
                Math.max(parseInt(req.query.limit as string, 10) || 20, 1),
                100
            );
            const offset = Math.max(
                parseInt(req.query.offset as string, 10) || 0,
                0
            );

            const validTypes = [
                "meal",
                "nutrition",
                "grocery",
                "budget",
                "family",
                "system",
            ];
            if (type && !validTypes.includes(type)) {
                throw new AppError(
                    400,
                    "Bad Request",
                    `Invalid notification type. Must be one of: ${validTypes.join(", ")}`
                );
            }

            const result = await getNotifications({
                customerId,
                type,
                limit,
                offset,
            });
            res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get unread notification count
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 */
router.get(
    "/unread-count",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const count = await getUnreadCount(customerId);
            res.set("Cache-Control", "private, max-age=15");
            res.json({ count });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark a notification as read
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Notification marked as read }
 *       404: { description: Notification not found }
 */
router.patch(
    "/:id/read",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const { id } = req.params;

            z.string().uuid().parse(id);

            const notification = await markAsRead(id, customerId);
            if (!notification) {
                throw new AppError(404, "Not Found", "Notification not found");
            }
            res.json({ notification });
            trackFeature(customerId, "notifications", "read");
        } catch (err) {
            next(err);
        }
    }
);

/**
 * @openapi
 * /notifications/read-all:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     responses:
 *       200:
 *         description: All marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 markedCount: { type: integer }
 */
router.post(
    "/read-all",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const count = await markAllAsRead(customerId);
            res.json({ markedCount: count });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * @openapi
 * /notifications/evaluate:
 *   post:
 *     tags: [Notifications]
 *     summary: Evaluate and dispatch notifications for current user
 *     parameters:
 *       - in: header
 *         name: x-timezone
 *         schema: { type: string }
 *         description: Client timezone (e.g. America/New_York)
 *     responses:
 *       200: { description: Evaluation results }
 */
router.post(
    "/evaluate",
    rateLimitMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const customerId = b2cId(req);
            const clientTimezone = req.headers["x-timezone"] as string | undefined;
            const result = await evaluateAndDispatchNotifications(customerId, clientTimezone);
            trackFeature(customerId, "notifications", "evaluate");
            res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

export default router;
