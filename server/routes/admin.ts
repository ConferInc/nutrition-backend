import { Router, type Request, type Response, type NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { auditedRoute } from "../middleware/audit.js";
import { setCurrentUser } from "../config/database.js";
import {
  createCuratedRecipe,
  updateCuratedRecipe,
  deleteCuratedRecipe,
  getAuditLog,
  getDashboardStats
} from "../services/admin.js";
import { insertRecipeSchema } from "../../shared/goldSchema.js";
import { getCircuitStatus } from "../services/ragClient.js";
import { logger } from "../config/logger.js";

const router = Router();

function requireAdminUserId(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) {
    const err = new Error("Unauthorized");
    (err as any).status = 401;
    throw err;
  }
  return userId;
}

// Development bypass for all admin routes
const isDev = process.env.NODE_ENV === 'development';
const adminBypassEnabled = process.env.ADMIN_BYPASS_ENABLED === 'true';

if (isDev && adminBypassEnabled) {
  // Local development with local DB — install dev bypass
  router.use(async (req, res, next) => {
    logger.info(`[ADMIN] Development bypass for: ${req.url}`);
    req.auth = {
      userId: 'dev-admin-user',
      email: 'dev@localhost',
      vendorId: '00000000-0000-0000-0000-000000000000',
      role: 'superadmin',
      permissions: ['*'],
      isAdmin: true,
      effectiveUserId: 'dev-admin-user',
      isImpersonating: false,
      profile: { role: 'admin' }
    };
    await setCurrentUser('dev-admin-user');
    next();
  });
} else {
  // Production OR dev-with-prod-DB — require real authentication
  if (isDev) {
    logger.warn("[ADMIN] ⛔ Dev bypass NOT enabled — set ADMIN_BYPASS_ENABLED=true in your environment to activate.");
  }
  router.use(authMiddleware);
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Authentication required",
        instance: req.url,
      });
    }
    if (!req.auth.isAdmin) {
      return res.status(403).json({
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "Admin access required",
        instance: req.url,
      });
    }
    next();
  });
}
router.use(rateLimitMiddleware);

/**
 * @openapi
 * /admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Get admin dashboard stats
 *     responses:
 *       200: { description: Dashboard statistics }
 *       403: { description: Admin access required }
 */
// Dashboard
router.get("/dashboard", async (req, res, next) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /admin/recipes:
 *   post:
 *     tags: [Admin]
 *     summary: Create a curated recipe
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Recipe created }
 */
// Curated recipe management
router.post("/recipes", auditedRoute("b2c_curated_recipes", async (req, res, next) => {
  try {
    const recipeData = insertRecipeSchema.parse(req.body);
    const recipe = await createCuratedRecipe(requireAdminUserId(req), recipeData, req.body.reason);
    res.status(201).json(recipe);
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /admin/recipes/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Update a curated recipe
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Recipe updated }
 */
router.put("/recipes/:id", auditedRoute("b2c_curated_recipes", async (req, res, next) => {
  try {
    const updates = insertRecipeSchema.partial().parse(req.body);
    const recipe = await updateCuratedRecipe(requireAdminUserId(req), req.params.id, updates, req.body.reason);
    res.json(recipe);
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /admin/recipes/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete a curated recipe
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Recipe deleted }
 *       400: { description: Reason required }
 */
router.delete("/recipes/:id", auditedRoute("b2c_curated_recipes", async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'Reason is required for recipe deletion',
        instance: req.url
      });
    }

    const result = await deleteCuratedRecipe(requireAdminUserId(req), req.params.id, reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /admin/user-recipes/{id}/approve:
 *   post:
 *     tags: [Admin]
 *     summary: Approve a user recipe (not implemented)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       501: { description: Not implemented }
 */
// User content moderation
router.post("/user-recipes/:id/approve", auditedRoute("b2c_user_recipes", async (req, res, next) => {
  try {
    res.status(501).json({ error: "User recipe moderation is not supported in the gold schema." });
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /admin/user-recipes/{id}/reject:
 *   post:
 *     tags: [Admin]
 *     summary: Reject a user recipe (not implemented)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       501: { description: Not implemented }
 */
router.post("/user-recipes/:id/reject", auditedRoute("b2c_user_recipes", async (req, res, next) => {
  try {
    res.status(501).json({ error: "User recipe moderation is not supported in the gold schema." });
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /admin/reports:
 *   get:
 *     tags: [Admin]
 *     summary: Get moderation reports (not implemented)
 *     responses:
 *       501: { description: Not implemented }
 */
// Reports and moderation
router.get("/reports", async (req, res, next) => {
  try {
    res.status(501).json({ error: "Reports are not supported in the gold schema." });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /admin/reports/{id}/resolve:
 *   post:
 *     tags: [Admin]
 *     summary: Resolve a report (not implemented)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       501: { description: Not implemented }
 */
router.post("/reports/:id/resolve", auditedRoute("b2c_recipe_reports", async (req, res, next) => {
  try {
    res.status(501).json({ error: "Report resolution is not supported in the gold schema." });
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /admin/audit:
 *   get:
 *     tags: [Admin]
 *     summary: Get audit logs
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: actor_user_id
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paginated audit logs }
 */
// Audit logs
router.get("/audit", async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const actorUserId = req.query.actor_user_id as string;

    const logs = await getAuditLog(limit, offset, actorUserId);
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /admin/refresh-materialized-views:
 *   post:
 *     tags: [Admin]
 *     summary: Refresh materialized views (not implemented)
 *     responses:
 *       501: { description: Not implemented }
 */
// System operations
router.post("/refresh-materialized-views", auditedRoute("materialized_views", async (req, res, next) => {
  try {
    res.status(501).json({ error: "Materialized views are not configured in the gold schema." });
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /admin/rag-status:
 *   get:
 *     tags: [Admin]
 *     summary: Get RAG circuit breaker status
 *     responses:
 *       200: { description: Circuit breaker state }
 */
// RAG circuit breaker diagnostics (PRD-09)
router.get("/rag-status", async (req, res, next) => {
  try {
    res.json(getCircuitStatus());
  } catch (error) {
    next(error);
  }
});

export default router;
