import { Router } from "express";
import { createUserRecipe, deleteUserRecipe, getUserRecipe, getUserRecipes, updateUserRecipe } from "../services/userContent.js";
import { requireB2cCustomerIdFromReq } from "../services/b2cIdentity.js";
import { authMiddleware } from "../middleware/auth.js";
import { trackFeature } from "../services/featureTracking.js";

function getJsonBody(req: any) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

const router = Router();

/**
 * @openapi
 * /user-recipes:
 *   get:
 *     tags: [User Recipes]
 *     summary: List current user's recipes
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200: { description: Paginated user recipes }
 */
router.get("/", authMiddleware, async (req, res, next) => {
  try {
    const b2cCustomerId = requireB2cCustomerIdFromReq(req);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 50)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const items = await getUserRecipes(b2cCustomerId, limit, offset);
    res.json({ items, limit, offset });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /user-recipes/{id}:
 *   get:
 *     tags: [User Recipes]
 *     summary: Get a single user recipe
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Recipe detail }
 *       404: { description: Recipe not found }
 */
router.get("/:id", authMiddleware, async (req, res, next) => {
  try {
    const b2cCustomerId = requireB2cCustomerIdFromReq(req);
    const row = await getUserRecipe(b2cCustomerId, req.params.id);
    res.json(row);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /user-recipes:
 *   post:
 *     tags: [User Recipes]
 *     summary: Create a new user recipe
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, ingredients, instructions]
 *             properties:
 *               title: { type: string, minLength: 2 }
 *               ingredients: { type: array, items: { type: object } }
 *               instructions: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Recipe created }
 *       400: { description: Validation error }
 */
router.post("/", authMiddleware, async (req, res, next) => {
  try {
    const b2cCustomerId = requireB2cCustomerIdFromReq(req);

    const body = getJsonBody(req);
    const p = body?.recipe ?? body;

    if (!p?.title || String(p.title).trim().length < 2) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!p?.ingredients || !Array.isArray(p.ingredients) || p.ingredients.length === 0) {
      return res.status(400).json({ error: "At least one ingredient is required" });
    }
    if (!p?.instructions || !Array.isArray(p.instructions) || p.instructions.length === 0) {
      return res.status(400).json({ error: "At least one instruction step is required" });
    }

    const row = await createUserRecipe(b2cCustomerId, p);
    trackFeature(b2cCustomerId, "recipe_save", "create");
    res.status(201).json(row);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /user-recipes/{id}:
 *   patch:
 *     tags: [User Recipes]
 *     summary: Update a user recipe
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Partial recipe update
 *     responses:
 *       200: { description: Recipe updated }
 */
router.patch("/:id", authMiddleware, async (req, res, next) => {
  try {
    const patch = getJsonBody(req)?.recipe ?? getJsonBody(req);
    const b2cCustomerId = requireB2cCustomerIdFromReq(req);
    const row = await updateUserRecipe(b2cCustomerId, req.params.id, patch);
    res.json(row);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /user-recipes/{id}:
 *   delete:
 *     tags: [User Recipes]
 *     summary: Delete a user recipe
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Recipe deleted }
 */
router.delete("/:id", authMiddleware, async (req, res, next) => {
  try {
    const b2cCustomerId = requireB2cCustomerIdFromReq(req);
    await deleteUserRecipe(b2cCustomerId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
