// server/services/groceryListUtils.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateIngredients,
  chooseCheapestUsd,
  estimateBucketPrice,
  canTransitionGroceryListStatus,
  type PlanIngredientRowLike,
  type ProductCandidateLike,
} from "./groceryListUtils.js";

describe("aggregateIngredients", () => {
  it("merges same ingredient with same unit into one bucket", () => {
    const rows: PlanIngredientRowLike[] = [
      { plan_servings: 2, recipe_servings: 4, ingredient_id: "a", ingredient_name: "Chicken", ingredient_category: "Protein", recipe_product_id: null, quantity: 500, unit: "g", quantity_normalized_g: 500 },
      { plan_servings: 3, recipe_servings: 3, ingredient_id: "a", ingredient_name: "Chicken", ingredient_category: "Protein", recipe_product_id: null, quantity: 300, unit: "g", quantity_normalized_g: 300 },
    ];
    const buckets = aggregateIngredients(rows);
    assert.equal(buckets.size, 1, "should merge into 1 bucket");
    const bucket = [...buckets.values()][0];
    // First: 500 * (2/4) = 250g, Second: 300 * (3/3) = 300g → total 550g
    assert.equal(bucket.quantity, 550, "should correctly scale and sum quantities");
  });

  it("keeps different units as separate buckets", () => {
    const rows: PlanIngredientRowLike[] = [
      { plan_servings: 1, recipe_servings: 1, ingredient_id: "b", ingredient_name: "Milk", ingredient_category: "Dairy", recipe_product_id: null, quantity: 2, unit: "cups", quantity_normalized_g: null },
      { plan_servings: 1, recipe_servings: 1, ingredient_id: "b", ingredient_name: "Milk", ingredient_category: "Dairy", recipe_product_id: null, quantity: 500, unit: "ml", quantity_normalized_g: null },
    ];
    const buckets = aggregateIngredients(rows);
    assert.equal(buckets.size, 2, "different units should create separate buckets");
  });

  it("handles zero/null recipe_servings safely (defaults to 1)", () => {
    const rows: PlanIngredientRowLike[] = [
      { plan_servings: 2, recipe_servings: 0, ingredient_id: "c", ingredient_name: "Salt", ingredient_category: "Spice", recipe_product_id: null, quantity: 5, unit: "tsp", quantity_normalized_g: null },
    ];
    const buckets = aggregateIngredients(rows);
    const bucket = [...buckets.values()][0];
    // recipe_servings defaults to 1, so: 5 * (2/1) = 10
    assert.equal(bucket.quantity, 10, "zero recipe_servings should default to 1");
  });

  it("collects linked product IDs", () => {
    const rows: PlanIngredientRowLike[] = [
      { plan_servings: 1, recipe_servings: 1, ingredient_id: "d", ingredient_name: "Olive Oil", ingredient_category: "Oil", recipe_product_id: "prod-1", quantity: 30, unit: "ml", quantity_normalized_g: null },
      { plan_servings: 1, recipe_servings: 1, ingredient_id: "d", ingredient_name: "Olive Oil", ingredient_category: "Oil", recipe_product_id: "prod-2", quantity: 15, unit: "ml", quantity_normalized_g: null },
    ];
    const buckets = aggregateIngredients(rows);
    const bucket = [...buckets.values()][0];
    assert.equal(bucket.linkedProductIds.size, 2, "should collect both product IDs");
  });

  it("returns empty map for empty input", () => {
    const buckets = aggregateIngredients([]);
    assert.equal(buckets.size, 0);
  });
});

describe("chooseCheapestUsd", () => {
  it("picks the cheapest USD product", () => {
    const candidates: ProductCandidateLike[] = [
      { id: "1", price: 5.99, currency: "USD", package_weight_g: 500 },
      { id: "2", price: 3.49, currency: "USD", package_weight_g: 250 },
      { id: "3", price: 7.00, currency: "USD", package_weight_g: 1000 },
    ];
    const best = chooseCheapestUsd(candidates);
    assert.equal(best?.id, "2", "should return the $3.49 product");
  });

  it("ignores non-USD products", () => {
    const candidates: ProductCandidateLike[] = [
      { id: "1", price: 1.00, currency: "EUR", package_weight_g: 500 },
      { id: "2", price: 5.00, currency: "USD", package_weight_g: 500 },
    ];
    const best = chooseCheapestUsd(candidates);
    assert.equal(best?.id, "2", "should skip EUR and pick USD");
  });

  it("returns null when no candidates have price", () => {
    const candidates: ProductCandidateLike[] = [
      { id: "1", price: null, currency: "USD", package_weight_g: 500 },
    ];
    assert.equal(chooseCheapestUsd(candidates), null);
  });

  it("returns null for empty array", () => {
    assert.equal(chooseCheapestUsd([]), null);
  });
});

describe("estimateBucketPrice", () => {
  it("estimates price based on weight when normalized grams available", () => {
    const bucket = { quantityNormalizedG: 750 };
    const candidate: ProductCandidateLike = { id: "1", price: 4.00, currency: "USD", package_weight_g: 500 };
    const price = estimateBucketPrice(bucket, candidate);
    assert.equal(price, 8.00, "750g / 500g = 2 packs → $8.00");
  });

  it("returns base price when no normalized grams", () => {
    const bucket = { quantityNormalizedG: null };
    const candidate: ProductCandidateLike = { id: "1", price: 3.50, currency: "USD", package_weight_g: 500 };
    const price = estimateBucketPrice(bucket, candidate);
    assert.equal(price, 3.50);
  });

  it("returns null when no candidate", () => {
    const price = estimateBucketPrice({ quantityNormalizedG: 500 }, null);
    assert.equal(price, null);
  });

  it("returns null when candidate has no price", () => {
    const price = estimateBucketPrice(
      { quantityNormalizedG: 500 },
      { id: "1", price: null, currency: "USD", package_weight_g: 500 }
    );
    assert.equal(price, null);
  });
});

describe("canTransitionGroceryListStatus", () => {
  it("allows draft → active", () => {
    assert.ok(canTransitionGroceryListStatus("draft", "active"));
  });

  it("allows active → purchased", () => {
    assert.ok(canTransitionGroceryListStatus("active", "purchased"));
  });

  it("allows purchased → active (un-complete)", () => {
    assert.ok(canTransitionGroceryListStatus("purchased", "active"));
  });

  it("allows same-state transition", () => {
    assert.ok(canTransitionGroceryListStatus("active", "active"));
  });

  it("blocks archived → any", () => {
    assert.ok(!canTransitionGroceryListStatus("archived", "active"));
    assert.ok(!canTransitionGroceryListStatus("archived", "purchased"));
  });

  it("blocks null/undefined current state", () => {
    assert.ok(!canTransitionGroceryListStatus(null, "active"));
    assert.ok(!canTransitionGroceryListStatus(undefined, "active"));
  });

  it("blocks draft → purchased (must go through active)", () => {
    assert.ok(!canTransitionGroceryListStatus("draft", "purchased"));
  });
});
