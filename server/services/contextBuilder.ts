// server/services/contextBuilder.ts
// PRD-33: Build a RecommendationContext for every RAG call
// ─────────────────────────────────────────────────────────

import { executeRaw } from "../config/database.js";

// ── Types ────────────────────────────────────────────────

export interface RecommendationContext {
  // Location-based (from households table)
  timezone: string;
  country: string | null;
  state: string | null;
  zipCode: string | null;

  // Time-derived (auto-calculated)
  mealTimeSlot: "morning" | "afternoon" | "evening" | "late_night";
  season: "spring" | "summer" | "fall" | "winter";
  dayOfWeek: string;
  isWeekend: boolean;

  // Preference-based (from DB)
  cuisinePreferences: string[];

  // Nutritional targets (from b2cCustomerHealthProfiles)
  targetCalories: number | null;
  targetProteinG: number | null;
  targetCarbsG: number | null;
  targetFatG: number | null;
  targetFiberG: number | null;
  targetSugarG: number | null;
  targetSodiumMg: number | null;

  // Recent history (auto-derived from meal_logs)
  recentMealIds: string[];
}

// ── Timezone Helpers ─────────────────────────────────────

/**
 * Get the current local hour in the user's timezone.
 */
function getLocalHour(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour");
    return parseInt(hourPart?.value ?? "12", 10);
  } catch {
    // Fallback to UTC hour if timezone is invalid
    return now.getUTCHours();
  }
}

/**
 * Determine if a timezone is in the Northern Hemisphere.
 * Uses timezone prefix heuristic: Asia/*, Europe/*, America/* → North;
 * Australia/*, Pacific/Auckland → South.
 */
function isNorthernHemisphere(timezone: string): boolean {
  const tz = timezone.toLowerCase();
  // Southern hemisphere timezones
  if (
    tz.startsWith("australia/") ||
    tz.startsWith("antarctica/") ||
    tz === "pacific/auckland" ||
    tz === "pacific/fiji" ||
    tz.startsWith("africa/") && (
      tz.includes("johannesburg") || tz.includes("harare") ||
      tz.includes("maputo") || tz.includes("windhoek")
    )
  ) {
    return false;
  }
  // South American southern timezones
  if (
    tz === "america/buenos_aires" || tz === "america/argentina/buenos_aires" ||
    tz === "america/sao_paulo" || tz === "america/santiago" ||
    tz === "america/montevideo"
  ) {
    return false;
  }
  return true;
}

// ── Context Derivation Functions ─────────────────────────

/**
 * Derive meal time slot from timezone + current server time.
 */
export function deriveMealTimeSlot(
  timezone: string
): RecommendationContext["mealTimeSlot"] {
  const now = new Date();
  const localHour = getLocalHour(now, timezone);

  if (localHour >= 5 && localHour < 12) return "morning";
  if (localHour >= 12 && localHour < 17) return "afternoon";
  if (localHour >= 17 && localHour < 22) return "evening";
  return "late_night";
}

/**
 * Derive season from timezone hemisphere + current date.
 */
export function deriveSeason(
  timezone: string
): RecommendationContext["season"] {
  const month = new Date().getMonth() + 1; // 1-12
  const isNorthern = isNorthernHemisphere(timezone);

  if (month >= 3 && month <= 5) return isNorthern ? "spring" : "fall";
  if (month >= 6 && month <= 8) return isNorthern ? "summer" : "winter";
  if (month >= 9 && month <= 11) return isNorthern ? "fall" : "spring";
  return isNorthern ? "winter" : "summer";
}

/**
 * Get user's recent meal recipe IDs (last 3 days) for dedup.
 */
export async function getRecentMealIds(
  customerId: string
): Promise<string[]> {
  const rows = await executeRaw(
    `SELECT DISTINCT mli.recipe_id
     FROM gold.meal_log_items mli
     JOIN gold.meal_logs ml ON ml.id = mli.meal_log_id
     WHERE ml.b2c_customer_id = $1
       AND ml.log_date >= CURRENT_DATE - INTERVAL '3 days'
       AND mli.recipe_id IS NOT NULL`,
    [customerId]
  );
  return (rows as any[]).map((r) => r.recipe_id);
}

/**
 * Get user's cuisine preferences from junction table.
 */
export async function getCuisinePreferences(
  customerId: string
): Promise<string[]> {
  const rows = await executeRaw(
    `SELECT c.name
     FROM gold.b2c_customer_cuisine_preferences cp
     JOIN gold.cuisines c ON c.id = cp.cuisine_id
     WHERE cp.b2c_customer_id = $1`,
    [customerId]
  );
  return (rows as any[]).map((r) => r.name);
}

/**
 * Get user's calorie/macro targets from health profile.
 */
export async function getHealthTargets(customerId: string): Promise<{
  targetCalories: number | null;
  targetProteinG: number | null;
  targetCarbsG: number | null;
  targetFatG: number | null;
  targetFiberG: number | null;
  targetSugarG: number | null;
  targetSodiumMg: number | null;
} | null> {
  const rows = await executeRaw(
    `SELECT target_calories, target_protein_g, target_carbs_g,
            target_fat_g, target_fiber_g, target_sugar_g, target_sodium_mg
     FROM gold.b2c_customer_health_profiles
     WHERE b2c_customer_id = $1
     LIMIT 1`,
    [customerId]
  );
  if (!(rows as any[]).length) return null;

  const r = (rows as any[])[0];
  return {
    targetCalories: r.target_calories ? Number(r.target_calories) : null,
    targetProteinG: r.target_protein_g ? Number(r.target_protein_g) : null,
    targetCarbsG: r.target_carbs_g ? Number(r.target_carbs_g) : null,
    targetFatG: r.target_fat_g ? Number(r.target_fat_g) : null,
    targetFiberG: r.target_fiber_g ? Number(r.target_fiber_g) : null,
    targetSugarG: r.target_sugar_g ? Number(r.target_sugar_g) : null,
    targetSodiumMg: r.target_sodium_mg ? Number(r.target_sodium_mg) : null,
  };
}

// ── Main Builder ─────────────────────────────────────────

export interface HouseholdLocation {
  timezone?: string;
  locationCountry?: string | null;
  locationState?: string | null;
  locationZipCode?: string | null;
}

/**
 * Build complete RecommendationContext for a customer.
 * All DB queries run in parallel for speed.
 */
export async function buildRecommendationContext(
  customerId: string,
  household: HouseholdLocation
): Promise<RecommendationContext> {
  const tz = household.timezone ?? "UTC";

  // Run all async lookups in parallel
  const [cuisinePrefs, recentMeals, healthTargets] = await Promise.all([
    getCuisinePreferences(customerId),
    getRecentMealIds(customerId),
    getHealthTargets(customerId),
  ]);

  const now = new Date();
  const dayOfWeek = now
    .toLocaleDateString("en-US", { weekday: "long", timeZone: tz })
    .toLowerCase();
  const dayNum = new Date(
    now.toLocaleString("en-US", { timeZone: tz })
  ).getDay();

  const context: RecommendationContext = {
    timezone: tz,
    country: household.locationCountry ?? null,
    state: household.locationState ?? null,
    zipCode: household.locationZipCode ?? null,
    mealTimeSlot: deriveMealTimeSlot(tz),
    season: deriveSeason(tz),
    dayOfWeek,
    isWeekend: dayNum === 0 || dayNum === 6,
    cuisinePreferences: cuisinePrefs,
    targetCalories: healthTargets?.targetCalories ?? null,
    targetProteinG: healthTargets?.targetProteinG ?? null,
    targetCarbsG: healthTargets?.targetCarbsG ?? null,
    targetFatG: healthTargets?.targetFatG ?? null,
    targetFiberG: healthTargets?.targetFiberG ?? null,
    targetSugarG: healthTargets?.targetSugarG ?? null,
    targetSodiumMg: healthTargets?.targetSodiumMg ?? null,
    recentMealIds: recentMeals,
  };

  console.info(JSON.stringify({
    event: "context_builder_output",
    mealSlot: context.mealTimeSlot,
    season: context.season,
    cuisines: context.cuisinePreferences.slice(0, 3),
    targetCal: context.targetCalories,
    recentMeals: context.recentMealIds.length,
    ts: new Date().toISOString(),
  }));

  return context;
}
