// server/services/contentPipelineClient.ts
// Fire-and-forget HTTP client for the Content Pipeline Service
// Mirrors allergenClient.ts pattern — non-blocking, non-critical path

import { logger } from "../config/logger.js";

// ── Configuration ────────────────────────────────────────────────────────────

const CONTENT_PIPELINE_URL = process.env.CONTENT_PIPELINE_URL || "";
const CONTENT_PIPELINE_API_KEY = process.env.CONTENT_PIPELINE_API_KEY || "";
const USE_CONTENT_PIPELINE = process.env.USE_CONTENT_PIPELINE === "true";
const TIMEOUT_MS = 60_000; // USDA fetch can take ~5-8s per new ingredient

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget call to the Content Pipeline Service for recipe backfill.
 *
 * Pre-condition (B2C has already done):
 *   - gold.recipes INSERT (via createUserRecipe)
 *   - gold.recipe_ingredients INSERT
 *
 * The pipeline will:
 *   1. Check each ingredient against gold.ingredients
 *   2. For NEW ingredients: run USDA enhanced pipeline → INSERT bronze.raw_ingredients
 *   3. INSERT bronze.raw_recipes (lineage record)
 *   4. Trigger bronze_to_gold orchestration flow
 *
 * On failure: silently logged. Recipe is already saved in gold.
 * The pipeline can be retried later — all operations are idempotent.
 */
export async function recipeBackfill(
  goldRecipeId: string,
  recipeData: Record<string, any>,
  ingredients: Array<{ item: string; qty?: number; unit?: string }>,
  sourceType: "user_generated" | "recipe_analyzer",
  submittedBy: string
): Promise<void> {
  // Gate: feature flag
  if (!USE_CONTENT_PIPELINE) {
    logger.debug("[contentPipeline] Pipeline disabled (USE_CONTENT_PIPELINE != true)");
    return;
  }

  if (!CONTENT_PIPELINE_URL) {
    logger.warn("[contentPipeline] CONTENT_PIPELINE_URL not configured, skipping backfill");
    return;
  }

  const url = `${CONTENT_PIPELINE_URL}/recipes/backfill`;
  const payload = {
    gold_recipe_id: goldRecipeId,
    recipe_data: recipeData,
    ingredients,
    source_type: sourceType,
    submitted_by: submittedBy,
  };

  logger.info(
    `[contentPipeline] Firing recipe backfill → ${url} | recipe="${recipeData.title}" goldId=${goldRecipeId}`
  );

  // Fire-and-forget: don't await in the caller's hot path
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": CONTENT_PIPELINE_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable>");
      logger.error(
        `[contentPipeline] Pipeline returned ${response.status}: ${body}`
      );
    } else {
      const result = await response.json().catch(() => ({}));
      logger.info(
        `[contentPipeline] Pipeline success: ${JSON.stringify(result)}`
      );
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      logger.error(`[contentPipeline] Pipeline timed out after ${TIMEOUT_MS}ms`);
    } else {
      logger.error(`[contentPipeline] Pipeline call failed:`, err);
    }
    // Non-critical: user's recipe is already saved in gold.recipes
  } finally {
    clearTimeout(timeout);
  }
}
