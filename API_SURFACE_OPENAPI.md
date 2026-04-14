# B2C Backend API Surface — OpenAPI 3.0 Specification

**Version:** 1.0.0  
**Last Updated:** 2026-04-13  
**Author:** Victor ⚡  
**Base URL:** `https://api.nutrismarts.ai/api/v1` (or `http://localhost:5000/api/v1` for local)

---

## Overview

The Nutrition B2C Backend API provides endpoints for:
- **User Management**: Profile, health data, settings
- **Recipes**: Search, save, rate, history, user-generated content
- **Meal Planning**: Plans, logs, grocery lists
- **AI Features**: Chat, analyzer, feed recommendations
- **Households**: Multi-user management
- **Scan**: Barcode/ingredient scanning
- **Admin**: Curated content, moderation, reports

---

## Authentication

All endpoints (except health checks and some public recipe endpoints) require authentication via JWT token.

**Header:** `Authorization: Bearer <jwt_token>`

---

## API Endpoints by Category

### 1. User Management (`/api/v1/me`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/profile` | ✅ | Get user profile |
| PATCH | `/profile` | ✅ | Update profile (name, email, phone, DOB, gender, diets, allergens) |
| DELETE | `/profile` | ✅ | Delete profile |
| GET | `/health` | ✅ | Get health profile |
| PATCH | `/health` | ✅ | Update health (height, weight, goals, targets, conditions) |
| GET | `/saved` | ✅ | Get saved recipes |
| POST | `/history` | ✅ | Log recipe view |
| GET | `/history` | ✅ | Get recipe history |
| GET | `/recently-viewed` | ✅ | Get recently viewed recipes |
| GET | `/most-cooked` | ✅ | Get most cooked recipes |
| POST | `/my-recipes` | ✅ | Create user recipe |
| GET | `/my-recipes` | ✅ | Get user's recipes |
| PATCH | `/my-recipes/:id` | ✅ | Update user recipe |
| POST | `/my-recipes/:id/share` | ✅ | Share recipe |
| POST | `/my-recipes/:id/unshare` | ✅ | Unshare recipe |
| POST | `/my-recipes/:id/submit` | ✅ | Submit for review |
| GET | `/settings` | ✅ | Get user settings |
| PATCH | `/settings` | ✅ | Update settings |
| DELETE | `/account` | ✅ | Delete account |
| POST | `/logout` | ✅ | Logout |

**Profile Schema (PATCH /profile):**
```json
{
  "fullName": "string | null",
  "email": "string | null",
  "phone": "string | null",
  "dateOfBirth": "string | null",
  "gender": "string | null",
  "diets": ["string"],
  "allergens": ["string"]
}
```

**Health Schema (PATCH /health):**
```json
{
  "heightCm": "number | null",
  "weightKg": "number | null",
  "activityLevel": "string | null",
  "healthGoal": "string | null",
  "targetWeightKg": "number | null",
  "targetCalories": "number | null",
  "targetProteinG": "number | null",
  "targetCarbsG": "number | null",
  "targetFatG": "number | null",
  "targetFiberG": "number | null",
  "targetSodiumMg": "number | null",
  "targetSugarG": "number | null",
  "intolerances": ["string"],
  "dislikedIngredients": ["string"],
  "onboardingComplete": "boolean",
  "conditions": ["string"],
  "allergens": ["string"],
  "diets": ["string"],
  "dateOfBirth": "string | null",
  "gender": "string | null"
}
```

---

### 2. Recipes (`/api/v1/recipes`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ⚡ (rate limited) | Search recipes (query params: q, filters, pagination) |
| GET | `/popular` | ⚡ (rate limited) | Get popular recipes |
| GET | `/:id` | ⚡ (rate limited) | Get recipe by ID |
| POST | `/:id/save` | ✅ | Save recipe |
| POST | `/:id/report` | ✅ | Report recipe |
| POST | `/:id/reject` | ✅ | Reject recipe recommendation |
| POST | `/:id/rate` | ✅ | Rate recipe |
| GET | `/:id/rating` | ✅ | Get user's rating for recipe |
| GET | `/r/:shareSlug` | ⚡ (rate limited) | Get shared recipe by slug |

---

### 3. Feed & Recommendations (`/api/v1/feed`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get personalized feed |
| GET | `/recommendations` | ✅ | Get recipe recommendations |

---

### 4. Meal Logging (`/api/v1/meal-log`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get meal logs |
| POST | `/` | ✅ | Create meal log entry |
| PUT | `/:id` | ✅ | Update meal log |
| DELETE | `/:id` | ✅ | Delete meal log |
| POST | `/:id/duplicate` | ✅ | Duplicate meal log |
| POST | `/:id/log` | ✅ | Log meal |
| GET | `/streak` | ✅ | Get meal log streak |
| GET | `/templates` | ✅ | Get meal log templates |
| POST | `/templates` | ✅ | Create template |
| GET | `/templates/:id` | ✅ | Get template |
| POST | `/templates/:id/apply` | ✅ | Apply template |

---

### 5. Meal Planning (`/api/v1/meal-plans`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | ✅ | Create meal plan |
| GET | `/` | ✅ | List meal plans |
| GET | `/:id` | ✅ | Get meal plan |
| PUT | `/:id` | ✅ | Update meal plan |
| POST | `/:id/generate` | ✅ | Generate plan with AI |
| POST | `/:id/regenerate` | ✅ | Regenerate plan |
| PATCH | `/:id/items/:itemId` | ✅ | Update plan item |
| DELETE | `/:id` | ✅ | Delete meal plan |
| POST | `/:id/items/:itemId/accept` | ✅ | Accept suggested item |
| DELETE | `/:id/items/:itemId/reject` | ✅ | Reject suggested item |
| POST | `/:id/items/:itemId/substitute` | ✅ | Get substitutions |

---

### 6. Households (`/api/v1/households`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get user's household |
| POST | `/` | ✅ | Create household |
| GET | `/:id` | ✅ | Get household details |
| PATCH | `/:id` | ✅ | Update household |
| PATCH | `/:id/members/:memberId` | ✅ | Update member |
| DELETE | `/:id/members/:memberId` | ✅ | Remove member |

**Household Invitations (`/api/v1/households/invitations`):**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | ✅ | Create invitation |
| GET | `/` | ✅ | List invitations |
| DELETE | `/:id` | ✅ | Cancel invitation |

**Household Preferences (`/api/v1/households/preferences`):**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get preferences |
| POST | `/` | ✅ | Create preference |
| DELETE | `/:id` | ✅ | Delete preference |

**Public Invitations (`/api/v1/invitations`):**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/:token` | ❌ | Get invitation by token |
| POST | `/:token/accept` | ✅ | Accept invitation |
| POST | `/:token/decline` | ✅ | Decline invitation |

---

### 7. Grocery Lists (`/api/v1/grocery-lists`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | ✅ | Create from meal plan |
| GET | `/` | ✅ | Get grocery lists |
| GET | `/:id` | ✅ | Get list details |
| PUT | `/:id` | ✅ | Update list |
| PUT | `/:id/items/:itemId` | ✅ | Update item |
| POST | `/:id/items/:itemId/toggle` | ✅ | Toggle item checked |
| GET | `/:id/share` | ✅ | Get share link |
| DELETE | `/:id` | ✅ | Delete list |
| GET | `/active` | ✅ | Get active list |

---

### 8. Budget (`/api/v1/budget`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get budget settings |
| POST | `/` | ✅ | Set budget |
| GET | `/history` | ✅ | Get budget history |
| GET | `/insights` | ✅ | Get spending insights |
| PUT | `/` | ✅ | Update budget |

---

### 9. Nutrition Dashboard (`/api/v1/nutrition-dashboard`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get dashboard data |
| GET | `/daily` | ✅ | Get daily nutrition |
| GET | `/weekly` | ✅ | Get weekly nutrition |
| GET | `/macros` | ✅ | Get macro breakdown |
| GET | `/trends` | ✅ | Get nutrition trends |
| GET | `/goals` | ✅ | Get goal progress |
| GET | `/recommendations` | ✅ | Get recommendations |

---

### 10. AI Chat (`/api/v1/chat`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | ✅ | Send chat message |
| GET | `/` | ✅ | Get chat history |

---

### 11. Analyzer (`/api/v1/analyzer`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/recipe` | ✅ | Analyze recipe |
| POST | `/ingredients` | ✅ | Analyze ingredients |
| POST | `/nutrition` | ✅ | Analyze nutrition |
| POST | `/recommendations` | ✅ | Get recommendations |
| POST | `/substitutions` | ✅ | Get substitutions |

---

### 12. Scan (`/api/v1/scan`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/barcode` | ✅ | Scan barcode |
| POST | `/ingredients` | ✅ | Scan ingredients list |
| GET | `/history` | ✅ | Get scan history |

---

### 13. Substitutions (`/api/v1/substitutions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get substitutions |
| GET | `/:ingredientId` | ✅ | Get for ingredient |

---

### 14. Ingredients (`/api/v1/ingredients`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/search` | ✅ | Search ingredients |

---

### 15. Taxonomy (Public Reference) (`/api/v1/taxonomy`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/allergens` | ❌ | List allergens |
| GET | `/health-conditions` | ❌ | List health conditions |
| GET | `/dietary-preferences` | ❌ | List dietary preferences |
| GET | `/cuisines` | ❌ | List cuisines |

---

### 16. Recipe Meta (`/api/v1/recipe-meta`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ❌ | Get recipe metadata |
| POST | `/detect-allergens` | ✅ | Detect allergens in ingredients |

---

### 17. User Recipes (`/api/v1/user-recipes`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | List user recipes |
| GET | `/:id` | ✅ | Get user recipe |
| POST | `/` | ✅ | Create user recipe |
| PATCH | `/:id` | ✅ | Update user recipe |
| DELETE | `/:id` | ✅ | Delete user recipe |

---

### 18. Notifications (`/api/v1/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get notifications |
| GET | `/unread-count` | ✅ | Get unread count |
| PATCH | `/:id/read` | ✅ | Mark as read |
| POST | `/preferences` | ✅ | Update preferences |
| POST | `/register-device` | ✅ | Register device |

---

### 19. NPS (`/api/v1/nps`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/eligible` | ✅ | Check if eligible for NPS |
| POST | `/` | ✅ | Submit NPS score |
| POST | `/dismiss` | ✅ | Dismiss NPS prompt |

---

### 20. Uploads (`/api/v1/uploads`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | ✅ | Upload file |
| DELETE | `/:id` | ✅ | Delete upload |

---

### 21. Grocery Preferences (`/api/v1/grocery-preferences`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | ✅ | Get preferences |
| GET | `/stores` | ✅ | Get preferred stores |
| PUT | `/` | ✅ | Update preferences |
| GET | `/suggestions` | ✅ | Get suggestions |

---

### 22. Sync (`/api/v1/sync`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/profile` | ✅ | Sync profile |
| POST | `/health` | ✅ | Sync health data |

---

### 23. Admin (`/api/v1/admin`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard` | ✅ (admin) | Admin dashboard stats |
| POST | `/recipes` | ✅ (admin) | Create curated recipe |
| PUT | `/recipes/:id` | ✅ (admin) | Update curated recipe |
| DELETE | `/recipes/:id` | ✅ (admin) | Delete curated recipe |
| POST | `/user-recipes/:id/approve` | ✅ (admin) | Approve user recipe |
| POST | `/user-recipes/:id/reject` | ✅ (admin) | Reject user recipe |
| GET | `/reports` | ✅ (admin) | Get reports |
| POST | `/reports/:id/resolve` | ✅ (admin) | Resolve report |
| GET | `/audit` | ✅ (admin) | Get audit log |
| POST | `/refresh-materialized-views` | ✅ (admin) | Refresh views |
| GET | `/rag-status` | ✅ (admin) | Get RAG pipeline status |

---

### 24. Health Checks (`/`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthz` | ❌ | Liveness probe |
| GET | `/readyz` | ❌ | Readiness probe |

---

## Common Response Schemas

### Success Response (200 OK)
```json
{
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### Error Response (4xx/5xx)
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... }
  }
}
```

---

## Middleware

- **authMiddleware**: JWT validation
- **rateLimitMiddleware**: Rate limiting per endpoint
- **idempotencyMiddleware**: Idempotency key handling
- **auditLogEntry**: Audit logging for sensitive operations

---

## Rate Limits

- Public endpoints: 100 req/min
- Authenticated endpoints: 1000 req/min
- Admin endpoints: 500 req/min

---

## Dependencies

- **Appwrite**: User authentication
- **Supabase**: Database (PostgreSQL)
- **OpenAI/Anthropic**: AI features (chat, analyzer)
- **Qdrant**: Vector search
- **Neo4j**: Graph relationships

---

## Files to Review for Full Spec

| Route File | Lines | Endpoints |
|------------|-------|-----------|
| `server/routes/user.ts` | ~600 | 20 |
| `server/routes/recipes.ts` | ~400 | 9 |
| `server/routes/mealLog.ts` | ~300 | 12 |
| `server/routes/mealPlan.ts` | ~350 | 11 |
| `server/routes/household.ts` | ~250 | 6 |
| `server/routes/groceryList.ts` | ~280 | 9 |
| `server/routes/admin.ts` | ~300 | 11 |

---

## Notes

- All timestamps are ISO 8601 format
- IDs are UUID v4
- Pagination uses `page` and `limit` query params
- Filters use query string syntax: `?diet=vegan&allergen=peanut`
- Some endpoints return streaming responses (chat)

---

## Sprint 2 Task: V-ARCH-1

**Status:** Complete  
**Next Steps:** 
- Generate formal OpenAPI YAML/JSON from this spec
- Add to repo documentation
- Consider tools like Swagger UI or Redoc for interactive docs