import { Router } from "express";
import { upsertProfileFromAppwrite, upsertHealthFromAppwrite } from "../services/supabaseSync.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

function getJsonBody(req: any) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

/**
 * @openapi
 * /sync/profile:
 *   post:
 *     tags: [Sync]
 *     summary: Sync user profile from Appwrite to Supabase
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [profile]
 *             properties:
 *               profile: { type: object }
 *               account: { type: object }
 *     responses:
 *       200: { description: Profile synced }
 *       400: { description: Missing user or profile }
 */
router.post("/profile", authMiddleware, async (req, res, next) => {
  try {
    const body = getJsonBody(req);
    const profile = body?.profile ?? null;
    const userId = (req as any).user?.effectiveUserId ?? (req as any).user?.userId;

    if (!userId || !profile) {
      return res.status(400).json({ error: "Missing authenticated user or profile" });
    }
    await upsertProfileFromAppwrite({ appwriteId: userId, profile, account: body?.account });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /sync/health:
 *   post:
 *     tags: [Sync]
 *     summary: Sync health profile from Appwrite to Supabase
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [health]
 *             properties:
 *               health: { type: object }
 *     responses:
 *       200: { description: Health synced }
 *       400: { description: Missing user or health }
 */
router.post("/health", authMiddleware, async (req, res, next) => {
  try {
    const body = getJsonBody(req);
    const health = body?.health ?? null;
    const userId = (req as any).user?.effectiveUserId ?? (req as any).user?.userId;

    if (!userId || !health) {
      return res.status(400).json({ error: "Missing authenticated user or health" });
    }
    await upsertHealthFromAppwrite({ appwriteId: userId, health });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
