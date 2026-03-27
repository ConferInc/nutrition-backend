import { executeRaw } from "../config/database.js";
import { getRecipeAllergenMap, getRecipeNutritionMap, hydrateRecipesByIds } from "./recipeHydration.js";
import { ragFeed, toRagScope } from "./ragClient.js";
import { getOrCreateHousehold } from "./household.js";
import { getMemberPrefs, toRagProfile, type MemberPrefs } from "./memberPrefs.js";
import { buildRecommendationContext } from "./contextBuilder.js";

export interface FeedResult {
  recipe: any;
  score: number;
  reasons: string[];
}

type UserPrefs = {
  dietIds: string[];
  allergenIds: string[];
  conditionIds: string[];
  dislikes: string[];
};

async function getUserPrefs(b2cCustomerId: string): Promise<UserPrefs> {
  return getEffectivePrefs(b2cCustomerId);
}

/**
 * Resolve effective preferences for a user or household member.
 * When memberId is provided, uses that member's health profile instead.
 */
async function getEffectivePrefs(b2cCustomerId: string, memberId?: string): Promise<UserPrefs> {
  if (memberId) {
    const prefs = await getMemberPrefs(memberId);
    return {
      dietIds: prefs.dietIds,
      allergenIds: prefs.allergenIds,
      conditionIds: prefs.conditionIds,
      dislikes: prefs.dislikes,
    };
  }

  const rows = await executeRaw(
    `
    select
      coalesce(array_remove(array_agg(distinct cdp.diet_id), null), '{}'::uuid[]) as diet_ids,
      coalesce(array_remove(array_agg(distinct ca.allergen_id), null), '{}'::uuid[]) as allergen_ids,
      coalesce(array_remove(array_agg(distinct chc.condition_id), null), '{}'::uuid[]) as condition_ids,
      coalesce(hp.disliked_ingredients, '{}'::text[]) as dislikes
    from gold.b2c_customers c
    left join gold.b2c_customer_dietary_preferences cdp
      on c.id = cdp.b2c_customer_id and cdp.is_active = true
    left join gold.b2c_customer_allergens ca
      on c.id = ca.b2c_customer_id and ca.is_active = true
    left join gold.b2c_customer_health_conditions chc
      on c.id = chc.b2c_customer_id and chc.is_active = true
    left join gold.b2c_customer_health_profiles hp
      on c.id = hp.b2c_customer_id
    where c.id = $1
    group by c.id, hp.disliked_ingredients
    `,
    [b2cCustomerId]
  );

  if (!rows.length) {
    return { dietIds: [], allergenIds: [], conditionIds: [], dislikes: [] };
  }

  const row = rows[0] as any;
  return {
    dietIds: row.diet_ids ?? [],
    allergenIds: row.allergen_ids ?? [],
    conditionIds: row.condition_ids ?? [],
    dislikes: row.dislikes ?? [],
  };
}

function mapFeedRecipe(row: any, nutritionMap: Map<string, any>, allergenMap: Map<string, any>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    cuisine: row.cuisine_id
      ? { id: row.cuisine_id, code: row.cuisine_code, name: row.cuisine_name }
      : null,
    mealType: row.meal_type,
    difficulty: row.difficulty,
    prepTimeMinutes: row.prep_time_minutes,
    cookTimeMinutes: row.cook_time_minutes,
    totalTimeMinutes: row.total_time_minutes,
    servings: row.servings,
    nutrition: nutritionMap.get(row.id) ?? {},
    allergens: allergenMap.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id,
  };
}

export async function getPersonalizedFeed(
  b2cCustomerId: string,
  limit: number = 200,
  offset: number = 0,
  memberId?: string,
  context?: { mealTimeSlot?: string; cuisinePreferences?: string[]; targetCalories?: number | null }
): Promise<FeedResult[]> {
  // Use member's ID for per-user joins (cuisine prefs, viewed-exclusion) when in member mode
  const effectiveUserId = memberId || b2cCustomerId;
  try {
    const prefs = await getEffectivePrefs(b2cCustomerId, memberId);
    const dislikes = prefs.dislikes.map((d) => d.toLowerCase());
    const sqlStart = Date.now();

    // Tier 1: Map mealTimeSlot to SQL meal_type
    const mealTypeMap: Record<string, string> = {
      morning: "breakfast", afternoon: "lunch",
      evening: "dinner", late_night: "snack",
    };
    const mealTypeFilter = context?.mealTimeSlot
      ? mealTypeMap[context.mealTimeSlot] ?? null
      : null;

    // Tier 3: Calorie range (per-meal = daily / 3, ±20%)
    const targetCalPerMeal = context?.targetCalories
      ? Math.round(context.targetCalories / 3)
      : null;

    const rows = await executeRaw(
      `
      select
        r.*,
        c.id as cuisine_id,
        c.code as cuisine_code,
        c.name as cuisine_name,
        coalesce(p.saved_30d, 0) as saved_30d,
        case when ccp.cuisine_id is not null then 1 else 0 end as cuisine_match
      from gold.recipes r
      left join gold.cuisines c on c.id = r.cuisine_id
      left join lateral (
        select count(*)::int as saved_30d
        from gold.customer_product_interactions cpi
        where cpi.recipe_id = r.id
          and cpi.entity_type = 'recipe'
          and cpi.interaction_type = 'saved'
          and cpi.interaction_timestamp > now() - interval '30 days'
      ) p on true
      -- Tier 2: Cuisine preference boost (LEFT JOIN — no exclusion)
      left join gold.b2c_customer_cuisine_preferences ccp
        on ccp.cuisine_id = r.cuisine_id and ccp.b2c_customer_id = $5  -- effectiveUserId (member or primary)
      -- Tier 3: Calorie lookup (LATERAL — per_serving preferred)
      left join lateral (
        select rnp.calories from gold.recipe_nutrition_profiles rnp
        where rnp.recipe_id = r.id
        order by case rnp.per_basis when 'per_serving' then 1 else 2 end
        limit 1
      ) cal on true
      where (coalesce(cardinality($1::uuid[]),0)=0 or not exists (
        select 1
        from gold.recipe_ingredients ri
        join gold.diet_ingredient_rules dir on dir.ingredient_id = ri.ingredient_id
        where ri.recipe_id = r.id
          and dir.diet_id = any($1)
          and dir.rule_type = 'forbidden'
      ))
      and (coalesce(cardinality($2::uuid[]),0)=0 or not exists (
        select 1
        from gold.recipe_ingredients ri
        join gold.ingredient_allergens ia on ia.ingredient_id = ri.ingredient_id
        where ri.recipe_id = r.id
          and ia.allergen_id = any($2)
      ))
      and (coalesce(cardinality($3::uuid[]),0)=0 or not exists (
        select 1
        from gold.recipe_ingredients ri
        join gold.health_condition_ingredient_restrictions hcir on hcir.ingredient_id = ri.ingredient_id
        where ri.recipe_id = r.id
          and hcir.condition_id = any($3)
          and hcir.restriction_type = 'forbidden'
      ))
      and (coalesce(cardinality($4::text[]),0)=0 or not exists (
        select 1
        from gold.recipe_ingredients ri
        join gold.ingredients i on i.id = ri.ingredient_id
        where ri.recipe_id = r.id
          and lower(i.name) = any($4)
      ))
      and not exists (
        select 1
        from gold.customer_product_interactions cpi
        where cpi.recipe_id = r.id
          and cpi.entity_type = 'recipe'
          and (cpi.interaction_type = 'viewed' or cpi.metadata->>'event' = 'viewed')
          and cpi.interaction_timestamp > now() - interval '48 hours'
          and cpi.b2c_customer_id = $5  -- effectiveUserId
      )
      -- Tier 1: Meal-type filter (null = no filter, null meal_type = passthrough)
      and ($8::text is null or r.meal_type is null or lower(r.meal_type) = lower($8))
      -- Tier 3: Calorie range filter (null = no filter, null calories = passthrough)
      and ($9::int is null or cal.calories is null or cal.calories between ($9 * 0.8) and ($9 * 1.2))
      order by
        -- Tier 2: Cuisine preference boost (5 points) + popularity
        (case when ccp.cuisine_id is not null then 5 else 0 end) + coalesce(p.saved_30d, 0)
        desc nulls last,
        r.updated_at desc, r.id asc
      limit $6 offset $7
      `,
      [
        prefs.dietIds,
        prefs.allergenIds,
        prefs.conditionIds,
        dislikes,
        effectiveUserId,
        limit,
        offset,
        mealTypeFilter,
        targetCalPerMeal,
      ]
    );

    const ids = rows.map((r: any) => r.id);

    console.info(JSON.stringify({
      event: "feed_sql_result",
      count: ids.length,
      topIds: ids.slice(0, 5),
      elapsedMs: Date.now() - sqlStart,
      filters: {
        diets: prefs.dietIds.length, allergens: prefs.allergenIds.length,
        conditions: prefs.conditionIds.length, dislikes: dislikes.length,
      },
      ts: new Date().toISOString(),
    }));

    const nutritionMap = await getRecipeNutritionMap(ids);
    const allergenMap = await getRecipeAllergenMap(ids);

    return rows.map((row: any) => {
      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
      const daysOld = Math.max(0, (Date.now() - updatedAt) / 86400000);
      const score = Number(row.saved_30d ?? 0) + 1 / (1 + daysOld);
      return {
        recipe: mapFeedRecipe(row, nutritionMap, allergenMap),
        score,
        reasons: [],
      };
    });
  } catch (error) {
    console.error("Personalized feed error:", error);
    throw new Error("Failed to generate personalized feed");
  }
}

export async function getFeedRecommendations(b2cCustomerId: string): Promise<{
  trending: any[];
  forYou: FeedResult[];
  recent: any[];
}> {
  try {
    const trendingRows = await executeRaw(
      `
      select
        r.*,
        c.id as cuisine_id,
        c.code as cuisine_code,
        c.name as cuisine_name,
        coalesce(p.saved_7d, 0) as saved_7d
      from gold.recipes r
      left join gold.cuisines c on c.id = r.cuisine_id
      left join lateral (
        select count(*)::int as saved_7d
        from gold.customer_product_interactions cpi
        where cpi.recipe_id = r.id
          and cpi.entity_type = 'recipe'
          and cpi.interaction_type = 'saved'
          and cpi.interaction_timestamp > now() - interval '7 days'
      ) p on true
      order by saved_7d desc nulls last, r.updated_at desc
      limit 10
      `
    );

    const recentRows = await executeRaw(
      `
      select
        r.*,
        c.id as cuisine_id,
        c.code as cuisine_code,
        c.name as cuisine_name
      from gold.recipes r
      left join gold.cuisines c on c.id = r.cuisine_id
      order by r.updated_at desc nulls last
      limit 10
      `
    );

    const ids = [...trendingRows, ...recentRows].map((r: any) => r.id);
    const nutritionMap = await getRecipeNutritionMap(ids);
    const allergenMap = await getRecipeAllergenMap(ids);

    const trending = trendingRows.map((row: any) => mapFeedRecipe(row, nutritionMap, allergenMap));
    const recent = recentRows.map((row: any) => mapFeedRecipe(row, nutritionMap, allergenMap));
    const forYou = await getPersonalizedFeed(b2cCustomerId, 20);

    return {
      trending,
      forYou,
      recent,
    };
  } catch (error) {
    console.error("Feed recommendations error:", error);
    throw new Error("Failed to get feed recommendations");
  }
}

// ── Graph-Enhanced Feed (PRD-11) ────────────────────────────────────────────

// Cold-start optimization (PRD-17): skip RAG for brand-new users
async function getUserInteractionCount(userId: string): Promise<number> {
  const result = await executeRaw(
    `SELECT COUNT(*)::int AS cnt FROM gold.customer_product_interactions
     WHERE b2c_customer_id = $1`,
    [userId]
  );
  return (result as any[])[0]?.cnt ?? 0;
}

export async function getPersonalizedFeedWithRAG(
  b2cCustomerId: string,
  limit: number = 200,
  offset: number = 0,
  memberId?: string
): Promise<FeedResult[]> {
  // PRD-17: skip RAG for zero-interaction users (collaborative filtering has no signal)
  const interactions = await getUserInteractionCount(b2cCustomerId);
  const feedStart = Date.now();

  // Resolve household context early — needed by SQL fallback in all paths
  const household = await getOrCreateHousehold(b2cCustomerId);

  // PRD-33: Build contextual recommendation context (time, season, cuisine, calories)
  const context = await buildRecommendationContext(b2cCustomerId, {
    timezone: household.timezone ?? undefined,
    locationCountry: household.locationCountry,
    locationState: (household as any).locationState,
    locationZipCode: (household as any).locationZipCode,
  });

  if (interactions === 0) {
    console.info(JSON.stringify({
      event: "feed_source_decision", source: "SQL_COLD_START",
      customerId: b2cCustomerId, memberId: memberId || null,
      interactionCount: 0, totalElapsedMs: Date.now() - feedStart,
      ts: new Date().toISOString(),
    }));
    return getPersonalizedFeed(b2cCustomerId, limit, offset, memberId, context);
  }

  // Resolve effective member prefs and RAG profile
  const effectiveId = memberId || b2cCustomerId;
  const prefs = await getEffectivePrefs(b2cCustomerId, memberId);

  // Build RAG member_profile for personalization when memberId is provided
  let memberProfile: Record<string, unknown> | undefined;
  if (memberId) {
    const memberFullPrefs = await getMemberPrefs(memberId);
    memberProfile = toRagProfile(memberFullPrefs);
  }

  // Try graph-powered personalization first
  const graphFeed = await ragFeed(
      b2cCustomerId, prefs, memberId, memberProfile,
      household.householdType ?? undefined,
      household.totalMembers ?? undefined,
      household.id,
      toRagScope(household.householdType),
      undefined, context
  );

  if (graphFeed && graphFeed.results.length > 0) {
    // Graph returned scored + explained results — hydrate from PG
    try {
      const ids = graphFeed.results.map(r => r.id);
      const hydrated = await hydrateRecipesByIds(ids);

      // hydrateRecipesByIds already returns camelCase recipe objects
      // (with imageUrl, nutrition, allergens etc.) — use them directly.
      const ragResults: FeedResult[] = hydrated.map((recipe, i) => ({
        recipe,
        score: graphFeed.results[i]?.score ?? 0,
        reasons: graphFeed.results[i]?.reasons ?? [],
      }));

      // Supplement with SQL results if RAG returned fewer than the limit
      if (ragResults.length < limit) {
        const sqlResults = await getPersonalizedFeed(b2cCustomerId, limit - ragResults.length, 0, memberId, context);
        const ragIdSet = new Set(ragResults.map(r => r.recipe.id));
        const dedupedSql = sqlResults.filter(r => !ragIdSet.has(r.recipe.id));
        const combined = [...ragResults, ...dedupedSql].slice(0, limit);
        console.info(JSON.stringify({
          event: "feed_source_decision", source: "RAG_PLUS_SQL",
          customerId: b2cCustomerId, memberId: memberId || null,
          interactionCount: interactions,
          ragCount: ragResults.length, sqlSupplement: dedupedSql.length,
          totalElapsedMs: Date.now() - feedStart,
          ts: new Date().toISOString(),
        }));
        return combined;
      }

      console.info(JSON.stringify({
        event: "feed_source_decision", source: "RAG",
        customerId: b2cCustomerId, memberId: memberId || null,
        interactionCount: interactions,
        ragCount: ragResults.length,
        totalElapsedMs: Date.now() - feedStart,
        ts: new Date().toISOString(),
      }));
      return ragResults;
    } catch (hydrationErr) {
      console.warn("[RAG] Feed hydration failed (non-UUID IDs?), falling back to SQL:", hydrationErr);
    }
  }

  // SQL fallback — existing logic (popularity + recency)
  console.info(JSON.stringify({
    event: "feed_source_decision", source: "SQL_FALLBACK",
    customerId: b2cCustomerId, memberId: memberId || null,
    interactionCount: interactions,
    ragCount: graphFeed?.results?.length ?? 0,
    totalElapsedMs: Date.now() - feedStart,
    ts: new Date().toISOString(),
  }));
  return getPersonalizedFeed(b2cCustomerId, limit, offset, memberId, context);
}

export async function getFeedRecommendationsWithRAG(b2cCustomerId: string, memberId?: string): Promise<{
  trending: any[];
  forYou: FeedResult[];
  recent: any[];
}> {
  try {
    // Option C: full per-member feed — apply member constraints to trending + recent too
    const prefs = memberId ? await getEffectivePrefs(b2cCustomerId, memberId) : null;

    // Trending: filter by member allergens/diets if member is selected
    const trendingRows = await executeRaw(
      `
      select
        r.*,
        c.id as cuisine_id,
        c.code as cuisine_code,
        c.name as cuisine_name,
        coalesce(p.saved_7d, 0) as saved_7d
      from gold.recipes r
      left join gold.cuisines c on c.id = r.cuisine_id
      left join lateral (
        select count(*)::int as saved_7d
        from gold.customer_product_interactions cpi
        where cpi.recipe_id = r.id
          and cpi.entity_type = 'recipe'
          and cpi.interaction_type = 'saved'
          and cpi.interaction_timestamp > now() - interval '7 days'
      ) p on true
      where (coalesce(cardinality($1::uuid[]),0)=0 or not exists (
        select 1
        from gold.recipe_ingredients ri
        join gold.ingredient_allergens ia on ia.ingredient_id = ri.ingredient_id
        where ri.recipe_id = r.id
          and ia.allergen_id = any($1)
      ))
      order by saved_7d desc nulls last, r.updated_at desc
      limit 10
      `,
      [prefs?.allergenIds ?? []]
    );

    // Recent: filter by member allergens if member is selected
    const recentRows = await executeRaw(
      `
      select
        r.*,
        c.id as cuisine_id,
        c.code as cuisine_code,
        c.name as cuisine_name
      from gold.recipes r
      left join gold.cuisines c on c.id = r.cuisine_id
      where (coalesce(cardinality($1::uuid[]),0)=0 or not exists (
        select 1
        from gold.recipe_ingredients ri
        join gold.ingredient_allergens ia on ia.ingredient_id = ri.ingredient_id
        where ri.recipe_id = r.id
          and ia.allergen_id = any($1)
      ))
      order by r.updated_at desc nulls last
      limit 10
      `,
      [prefs?.allergenIds ?? []]
    );

    const ids = [...trendingRows, ...recentRows].map((r: any) => r.id);
    const nutritionMap = await getRecipeNutritionMap(ids);
    const allergenMap = await getRecipeAllergenMap(ids);

    const trending = trendingRows.map((row: any) => mapFeedRecipe(row, nutritionMap, allergenMap));
    const recent = recentRows.map((row: any) => mapFeedRecipe(row, nutritionMap, allergenMap));

    // ForYou: graph-enhanced (RAG → SQL fallback) — uses member prefs
    const forYou = await getPersonalizedFeedWithRAG(b2cCustomerId, 20, 0, memberId);

    return { trending, forYou, recent };
  } catch (error) {
    console.error("Feed recommendations (RAG) error:", error);
    throw new Error("Failed to get feed recommendations");
  }
}
