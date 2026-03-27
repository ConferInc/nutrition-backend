import { Router } from "express";
import { executeRaw } from "../config/database.js";

const router = Router();

/**
 * @openapi
 * /taxonomy/allergens:
 *   get:
 *     tags: [Taxonomy]
 *     summary: List all allergens
 *     security: []
 *     responses:
 *       200: { description: Array of allergens with id, code, name, category }
 */
router.get("/allergens", async (req, res, next) => {
  try {
    const rows = await executeRaw(
      `
      select id as gold_id, code, name, category
      from gold.allergens
      order by name
      `
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /taxonomy/health-conditions:
 *   get:
 *     tags: [Taxonomy]
 *     summary: List all health conditions
 *     security: []
 *     responses:
 *       200: { description: Array of health conditions }
 */
router.get("/health-conditions", async (req, res, next) => {
  try {
    const rows = await executeRaw(
      `
      select id as gold_id, code, name, category
      from gold.health_conditions
      order by name
      `
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /taxonomy/dietary-preferences:
 *   get:
 *     tags: [Taxonomy]
 *     summary: List dietary preferences (lifestyle and religious)
 *     security: []
 *     responses:
 *       200: { description: Array of dietary preferences }
 */
router.get("/dietary-preferences", async (req, res, next) => {
  try {
    const rows = await executeRaw(
      `
      select id as gold_id, code, name, category
      from gold.dietary_preferences
      where upper(category) in ('ETHICAL_RELIGIOUS', 'LIFESTYLE')
      order by name
      `
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /taxonomy/cuisines:
 *   get:
 *     tags: [Taxonomy]
 *     summary: List all cuisines
 *     security: []
 *     responses:
 *       200: { description: Array of cuisines }
 */
router.get("/cuisines", async (req, res, next) => {
  try {
    const rows = await executeRaw(
      `
      select id as gold_id, code, name, coalesce(region, country) as category
      from gold.cuisines
      order by name
      `
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

export default router;
