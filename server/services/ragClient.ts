/**
 * RAG Client — PRD-01 Foundation
 * ------------------------------
 * Circuit breaker + feature-flag gated HTTP client for the RAG API (FastAPI).
 * When RAG returns null (flag OFF, circuit OPEN, or API error), callers fall back to SQL.
 * Silent degradation: existing workflow unchanged.
 */

export interface CircuitState {
  status: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  lastFailureAt: number;
  cooldownMs: number;
}

const circuit: CircuitState = {
  status: "CLOSED",
  failureCount: 0,
  lastFailureAt: 0,
  cooldownMs: 30_000,
};

/**
 * Call RAG API with 3 gates: feature flag, circuit breaker, HTTP+timeout.
 * Returns null on any gate failure → caller uses SQL fallback.
 */
export async function callRag<T>(
  endpoint: string,
  body: Record<string, unknown>,
  featureFlag: string,
  timeoutMs: number = 5000
): Promise<T | null> {
  // Guard: RAG not configured
  if (!process.env.RAG_API_URL || !process.env.RAG_API_KEY) return null;

  // Gate 1: Feature flag
  if (process.env[featureFlag] !== "true") return null;

  // Gate 2: Circuit breaker
  if (circuit.status === "OPEN") {
    if (Date.now() - circuit.lastFailureAt > circuit.cooldownMs) {
      circuit.status = "HALF_OPEN";
    } else {
      return null;
    }
  }

  // Gate 3: HTTP call with timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const baseUrl = process.env.RAG_API_URL.replace(/\/$/, "");
    const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.RAG_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) throw new Error(`RAG API ${res.status}`);

    const data = (await res.json()) as T;
    circuit.status = "CLOSED";
    circuit.failureCount = 0;
    return data;
  } catch (err) {
    circuit.failureCount++;
    circuit.lastFailureAt = Date.now();
    if (circuit.failureCount >= 3) circuit.status = "OPEN";
    console.error(`[ragClient] ${endpoint} failed (${circuit.failureCount}/3):`, err);
    return null;
  }
}

// Convenience wrappers for each feature (PRD-01)
// Typed as `any` because RAG API responses are dynamic shapes from FastAPI
export const ragRecommend = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/recommend-products", body, "USE_GRAPH_RECOMMEND", 5000);

export const ragSearch = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/search", body, "USE_GRAPH_SEARCH", 3000);

export const ragMatch = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/product-customers", body, "USE_GRAPH_MATCH", 5000);

export const ragChat = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/chat", body, "USE_GRAPH_CHATBOT", 10_000);

export const ragSafetyCheck = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/safety-check", body, "USE_GRAPH_SAFETY", 5000);

export const ragSubstitutions = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/substitutions", body, "USE_GRAPH_SUBSTITUTE", 5000);

export const ragProductIntel = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/product-intel", body, "USE_GRAPH_INTEL", 3000);

export const ragSearchSuggest = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2b/search-suggest", body, "USE_GRAPH_SEARCH", 3000);

// B2C convenience wrappers
export const ragFeed = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2c/feed", body, "USE_RAG_FEED", 5000);

export const ragProducts = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2c/products", body, "USE_RAG_PRODUCTS", 5000);

export const ragAlternatives = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2c/alternatives", body, "USE_RAG_ALTERNATIVES", 5000);

export const ragIngredientSubstitutions = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2c/ingredient-substitutions", body, "USE_RAG_SUBSTITUTE", 5000);

export const ragMealPatterns = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2c/meal-patterns", body, "USE_RAG_MEAL_PATTERNS", 5000);

export const ragMealCandidates = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2c/meal-candidates", body, "USE_RAG_MEAL_CANDIDATES", 5000);

export const ragNotifications = (body: Record<string, unknown>): Promise<any> =>
  callRag("/b2c/notifications", body, "USE_RAG_NOTIFICATIONS", 5000);

/** Identity helper — passes scope through as-is for RAG calls */
export const toRagScope = (scope: string | null | Record<string, unknown>) => scope;

export function getCircuitStatus(): CircuitState {
  return { ...circuit };
}
