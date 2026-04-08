// server/services/foodPyramidValidator.ts
// PRD-34: USDA 2025 Food Pyramid — Post-generation meal plan audit
// ──────────────────────────────────────────────────────────────────

import { executeRaw } from "../config/database.js";
import { logger } from "../config/logger.js";

// ── Types ────────────────────────────────────────────────────────

export interface FoodGroupAudit {
  group: string;
  targetMin: number;
  targetMax: number;
  unit: string;
  actual: number;
  status: "adequate" | "below" | "above";
  pyramidPriority: number;
}

interface RecipeLike {
  recipeId?: string;
  title?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
}

// ── Food Group Heuristic ────────────────────────────────────────
// Infers food groups from recipe title keywords + macro thresholds.
// ~70% accuracy — sufficient for advisory warnings, not clinical.

const PROTEIN_KEYWORDS = [
  "chicken", "beef", "pork", "lamb", "turkey", "duck", "steak",
  "salmon", "tuna", "shrimp", "fish", "seafood", "lobster", "crab",
  "egg", "tofu", "tempeh", "lentil", "bean", "chickpea", "edamame",
  "protein", "meat", "sausage", "bacon", "ham", "venison",
];

const DAIRY_KEYWORDS = [
  "cheese", "yogurt", "milk", "cream", "butter", "paneer",
  "ricotta", "mozzarella", "parmesan", "cheddar", "feta",
  "dairy", "whey", "cottage cheese", "ice cream",
];

const VEGETABLE_KEYWORDS = [
  "salad", "broccoli", "spinach", "kale", "carrot", "tomato",
  "pepper", "onion", "zucchini", "cucumber", "lettuce", "cabbage",
  "cauliflower", "asparagus", "celery", "mushroom", "eggplant",
  "squash", "pumpkin", "sweet potato", "beet", "corn", "pea",
  "green bean", "brussels sprout", "artichoke", "vegetable",
  "veggie", "stir fry", "stir-fry", "ratatouille",
];

const FRUIT_KEYWORDS = [
  "apple", "banana", "berry", "blueberry", "strawberry", "raspberry",
  "mango", "pineapple", "orange", "peach", "pear", "grape", "melon",
  "watermelon", "kiwi", "cherry", "plum", "fig", "date", "papaya",
  "fruit", "smoothie", "acai", "pomegranate", "lemon", "lime",
];

const GRAIN_KEYWORDS = [
  "rice", "pasta", "bread", "noodle", "quinoa", "oat", "oatmeal",
  "cereal", "tortilla", "wrap", "couscous", "barley", "bulgur",
  "farro", "wheat", "grain", "granola", "pancake", "waffle",
  "muffin", "bagel", "pita", "flatbread", "roti", "naan",
];

function titleContainsAny(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

export function inferFoodGroups(recipe: RecipeLike): Set<string> {
  const groups = new Set<string>();
  const title = recipe.title ?? "";
  const proteinG = recipe.proteinG ?? 0;
  const fiberG = recipe.fiberG ?? 0;

  // Title-based classification
  if (titleContainsAny(title, PROTEIN_KEYWORDS)) groups.add("protein");
  if (titleContainsAny(title, DAIRY_KEYWORDS)) groups.add("dairy");
  if (titleContainsAny(title, VEGETABLE_KEYWORDS)) groups.add("vegetables");
  if (titleContainsAny(title, FRUIT_KEYWORDS)) groups.add("fruits");
  if (titleContainsAny(title, GRAIN_KEYWORDS)) groups.add("whole_grains");

  // Macro-based fallback classification
  if (proteinG >= 15 && !groups.has("protein")) groups.add("protein");
  if (fiberG >= 4 && !groups.has("vegetables") && !groups.has("fruits")) {
    groups.add("vegetables"); // High-fiber likely has vegetables
  }

  // If nothing detected, classify by dominant macro
  if (groups.size === 0) {
    const carbsG = recipe.carbsG ?? 0;
    if (proteinG > carbsG && proteinG > (recipe.fatG ?? 0)) {
      groups.add("protein");
    } else if (carbsG > proteinG) {
      groups.add("whole_grains");
    }
  }

  return groups;
}

// ── Diet-Aware Food Group Skipping ──────────────────────────────
// Skip food groups that conflict with user dietary preferences.
// USDA guidelines are advisory — user preferences ALWAYS win.

const DAIRY_CONFLICTING_DIETS = ["vegan", "dairy-free", "lactose-free", "paleo"];
const GRAIN_CONFLICTING_DIETS = ["keto", "low-carb", "grain-free", "paleo", "carnivore"];
const FRUIT_CONFLICTING_DIETS = ["carnivore"];
const VEGETABLE_CONFLICTING_DIETS = ["carnivore"];

function getSkippedGroups(memberDiets: string[]): Set<string> {
  const skipped = new Set<string>();
  const dietsLower = memberDiets.map((d) => d.toLowerCase());

  if (dietsLower.some((d) => DAIRY_CONFLICTING_DIETS.includes(d))) skipped.add("dairy");
  if (dietsLower.some((d) => GRAIN_CONFLICTING_DIETS.includes(d))) skipped.add("whole_grains");
  if (dietsLower.some((d) => FRUIT_CONFLICTING_DIETS.includes(d))) skipped.add("fruits");
  if (dietsLower.some((d) => VEGETABLE_CONFLICTING_DIETS.includes(d))) skipped.add("vegetables");

  return skipped;
}

// ── Audit Engine ────────────────────────────────────────────────

export async function auditMealPlanAgainstGuidelines(
  meals: Array<{ recipeId: string; servings: number; date: string }>,
  recipeLookup: Map<string, RecipeLike>,
  userCalorieTarget: number,
  memberDiets: string[] = []
): Promise<FoodGroupAudit[]> {
  // 1. Load guidelines from DB
  let guidelines: any[];
  try {
    guidelines = (await executeRaw(
      `SELECT food_group, daily_target_min, daily_target_max, daily_target_unit,
              calorie_percentage, pyramid_priority, calorie_basis
       FROM gold.nutritional_guidelines
       WHERE model_name = 'usda_2025' AND is_active = true
       ORDER BY pyramid_priority ASC`
    )) as any[];
  } catch (err) {
    logger.warn("[FoodPyramid] Could not load guidelines from DB, using defaults");
    guidelines = [
      { food_group: "protein",      daily_target_min: 5.5, daily_target_max: 6.5, daily_target_unit: "oz_eq",  calorie_percentage: 35, pyramid_priority: 1, calorie_basis: 2000 },
      { food_group: "dairy",        daily_target_min: 3.0, daily_target_max: 3.0, daily_target_unit: "cup_eq", calorie_percentage: 15, pyramid_priority: 2, calorie_basis: 2000 },
      { food_group: "vegetables",   daily_target_min: 2.5, daily_target_max: 3.0, daily_target_unit: "cup_eq", calorie_percentage: 20, pyramid_priority: 3, calorie_basis: 2000 },
      { food_group: "fruits",       daily_target_min: 1.5, daily_target_max: 2.0, daily_target_unit: "cup_eq", calorie_percentage: 10, pyramid_priority: 4, calorie_basis: 2000 },
      { food_group: "whole_grains", daily_target_min: 5.0, daily_target_max: 6.0, daily_target_unit: "oz_eq",  calorie_percentage: 20, pyramid_priority: 5, calorie_basis: 2000 },
    ];
  }

  // 2. Scale targets to user's calorie level
  const scaleFactor = userCalorieTarget / 2000;

  // 3. Count unique dates in the plan
  const uniqueDates = new Set(meals.map((m) => m.date));
  const totalDays = Math.max(uniqueDates.size, 1);

  // 4. Aggregate food groups across all meals
  const groupCounts: Record<string, number> = {
    protein: 0,
    dairy: 0,
    vegetables: 0,
    fruits: 0,
    whole_grains: 0,
  };

  for (const meal of meals) {
    const recipe = recipeLookup.get(meal.recipeId);
    if (!recipe) continue;
    const groups = inferFoodGroups(recipe);
    for (const g of groups) {
      if (g in groupCounts) {
        groupCounts[g] += meal.servings;
      }
    }
  }

  // 5. Compute daily averages and compare against scaled targets
  // Skip food groups that conflict with user dietary preferences
  const skippedGroups = getSkippedGroups(memberDiets);

  return guidelines
    .filter((g: any) => !skippedGroups.has(g.food_group))
    .map((g: any) => {
    const scaledMin = Number(g.daily_target_min) * scaleFactor;
    const scaledMax = Number(g.daily_target_max) * scaleFactor;
    const dailyAvg = groupCounts[g.food_group] / totalDays;

    // We compare serving counts (heuristic) against the scaled target range.
    // Since we're counting "recipe appearances" not actual cups/oz, this is
    // an approximation: >=1 serving/day ≈ adequate for most food groups.
    const minThreshold = Math.max(1, Math.floor(scaledMin / 2));

    return {
      group: g.food_group,
      targetMin: scaledMin,
      targetMax: scaledMax,
      unit: g.daily_target_unit,
      actual: Math.round(dailyAvg * 100) / 100,
      status: dailyAvg < minThreshold ? "below" as const : dailyAvg > scaledMax ? "above" as const : "adequate" as const,
      pyramidPriority: Number(g.pyramid_priority),
    };
  });
}

// ── Human-Readable Warnings ─────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  protein: "Protein",
  dairy: "Dairy",
  vegetables: "Vegetables",
  fruits: "Fruits",
  whole_grains: "Whole Grains",
};

export function formatAuditWarnings(audit: FoodGroupAudit[]): string[] {
  return audit
    .filter((a) => a.status === "below")
    .sort((a, b) => a.pyramidPriority - b.pyramidPriority)
    .map((a) => {
      const label = GROUP_LABELS[a.group] ?? a.group;
      return `Advisory: Low ${label} — your plan averages ${a.actual} servings/day (USDA target: ${a.targetMin}–${a.targetMax} ${a.unit}/day)`;
    });
}
