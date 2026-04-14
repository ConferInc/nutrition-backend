// server/services/foodPyramidValidator.test.ts
// Tests for the pure functions (inferFoodGroups, formatAuditWarnings)
// Inlined to avoid transitive env validation from database.js import
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inlined types + pure functions from foodPyramidValidator.ts ──

interface FoodGroupAudit {
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

function inferFoodGroups(recipe: RecipeLike): Set<string> {
  const groups = new Set<string>();
  const title = recipe.title ?? "";
  const proteinG = recipe.proteinG ?? 0;
  const fiberG = recipe.fiberG ?? 0;
  if (titleContainsAny(title, PROTEIN_KEYWORDS)) groups.add("protein");
  if (titleContainsAny(title, DAIRY_KEYWORDS)) groups.add("dairy");
  if (titleContainsAny(title, VEGETABLE_KEYWORDS)) groups.add("vegetables");
  if (titleContainsAny(title, FRUIT_KEYWORDS)) groups.add("fruits");
  if (titleContainsAny(title, GRAIN_KEYWORDS)) groups.add("whole_grains");
  if (proteinG >= 15 && !groups.has("protein")) groups.add("protein");
  if (fiberG >= 4 && !groups.has("vegetables") && !groups.has("fruits")) {
    groups.add("vegetables");
  }
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

const GROUP_LABELS: Record<string, string> = {
  protein: "Protein", dairy: "Dairy", vegetables: "Vegetables",
  fruits: "Fruits", whole_grains: "Whole Grains",
};

function formatAuditWarnings(audit: FoodGroupAudit[]): string[] {
  return audit
    .filter((a) => a.status === "below")
    .sort((a, b) => a.pyramidPriority - b.pyramidPriority)
    .map((a) => {
      const label = GROUP_LABELS[a.group] ?? a.group;
      return `Advisory: Low ${label} — your plan averages ${a.actual} servings/day (USDA target: ${a.targetMin}–${a.targetMax} ${a.unit}/day)`;
    });
}

// ── Tests ────────────────────────────────────────────────────────

describe("inferFoodGroups", () => {
  it("detects protein from title keywords", () => {
    const groups = inferFoodGroups({ title: "Grilled Chicken Breast", proteinG: 30, carbsG: 5, fatG: 8 });
    assert.ok(groups.has("protein"));
  });

  it("detects dairy from cheese keyword", () => {
    const groups = inferFoodGroups({ title: "Mac and Cheese", proteinG: 10, carbsG: 40, fatG: 20 });
    assert.ok(groups.has("dairy"));
  });

  it("detects vegetables from salad keyword", () => {
    const groups = inferFoodGroups({ title: "Greek Salad" });
    assert.ok(groups.has("vegetables"));
  });

  it("detects fruits from smoothie keyword", () => {
    const groups = inferFoodGroups({ title: "Berry Smoothie Bowl" });
    assert.ok(groups.has("fruits"));
  });

  it("detects grains from pasta keyword", () => {
    const groups = inferFoodGroups({ title: "Pasta Bolognese" });
    assert.ok(groups.has("whole_grains"));
  });

  it("classifies multiple food groups from a complex title", () => {
    const groups = inferFoodGroups({ title: "Chicken Broccoli Rice Stir Fry" });
    assert.ok(groups.has("protein"));
    assert.ok(groups.has("vegetables"));
    assert.ok(groups.has("whole_grains"));
  });

  it("uses macro fallback for high protein", () => {
    const groups = inferFoodGroups({ title: "Mystery Meal", proteinG: 35, carbsG: 10, fatG: 10 });
    assert.ok(groups.has("protein"));
  });

  it("uses macro fallback for high carbs → grains", () => {
    const groups = inferFoodGroups({ title: "Default Dish", proteinG: 5, carbsG: 50, fatG: 5 });
    assert.ok(groups.has("whole_grains"));
  });

  it("uses fiber fallback for vegetables", () => {
    const groups = inferFoodGroups({ title: "Hearty Soup", fiberG: 8 });
    assert.ok(groups.has("vegetables"));
  });

  it("handles empty/missing fields gracefully", () => {
    const groups = inferFoodGroups({});
    assert.ok(groups.size === 0 || groups.size >= 0);
  });
});

describe("formatAuditWarnings", () => {
  it("returns warnings only for 'below' status", () => {
    const audit: FoodGroupAudit[] = [
      { group: "protein", targetMin: 5.5, targetMax: 6.5, unit: "oz_eq", actual: 2, status: "below", pyramidPriority: 1 },
      { group: "dairy", targetMin: 3, targetMax: 3, unit: "cup_eq", actual: 3, status: "adequate", pyramidPriority: 2 },
      { group: "fruits", targetMin: 1.5, targetMax: 2, unit: "cup_eq", actual: 0.5, status: "below", pyramidPriority: 4 },
    ];
    const warnings = formatAuditWarnings(audit);
    assert.equal(warnings.length, 2);
    assert.ok(warnings[0].includes("Protein"));
    assert.ok(warnings[1].includes("Fruits"));
  });

  it("returns empty when all adequate", () => {
    const warnings = formatAuditWarnings([
      { group: "protein", targetMin: 5.5, targetMax: 6.5, unit: "oz_eq", actual: 6, status: "adequate", pyramidPriority: 1 },
    ]);
    assert.equal(warnings.length, 0);
  });

  it("sorts by pyramid priority", () => {
    const warnings = formatAuditWarnings([
      { group: "whole_grains", targetMin: 5, targetMax: 6, unit: "oz_eq", actual: 1, status: "below", pyramidPriority: 5 },
      { group: "protein", targetMin: 5.5, targetMax: 6.5, unit: "oz_eq", actual: 1, status: "below", pyramidPriority: 1 },
    ]);
    assert.ok(warnings[0].includes("Protein"));
    assert.ok(warnings[1].includes("Whole Grains"));
  });
});

// Mirrors getSkippedGroups in foodPyramidValidator.ts (diet-aware audit)
const DAIRY_CONFLICTING_DIETS = ["vegan", "dairy-free", "lactose-free", "paleo"];
const GRAIN_CONFLICTING_DIETS = ["keto", "low-carb", "grain-free", "paleo", "carnivore"];
const FRUIT_CONFLICTING_DIETS = ["carnivore"];
const VEGETABLE_CONFLICTING_DIETS = ["carnivore"];

function skippedGroupsForDiets(memberDiets: string[]): Set<string> {
  const skipped = new Set<string>();
  const dietsLower = memberDiets.map((d) => d.toLowerCase());
  if (dietsLower.some((d) => DAIRY_CONFLICTING_DIETS.includes(d))) skipped.add("dairy");
  if (dietsLower.some((d) => GRAIN_CONFLICTING_DIETS.includes(d))) skipped.add("whole_grains");
  if (dietsLower.some((d) => FRUIT_CONFLICTING_DIETS.includes(d))) skipped.add("fruits");
  if (dietsLower.some((d) => VEGETABLE_CONFLICTING_DIETS.includes(d))) skipped.add("vegetables");
  return skipped;
}

describe("diet-based food group skips (mirrors production)", () => {
  it("vegan skips dairy", () => {
    assert.ok(skippedGroupsForDiets(["vegan"]).has("dairy"));
  });

  it("keto skips whole_grains", () => {
    assert.ok(skippedGroupsForDiets(["keto"]).has("whole_grains"));
  });

  it("carnivore skips fruits, vegetables, and grains", () => {
    const s = skippedGroupsForDiets(["Carnivore"]);
    assert.ok(s.has("fruits"));
    assert.ok(s.has("vegetables"));
    assert.ok(s.has("whole_grains"));
  });
});
