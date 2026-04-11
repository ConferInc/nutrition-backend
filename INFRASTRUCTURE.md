# NutriSmarts Backend - Infrastructure Documentation

> **Last Updated:** April 11, 2026
> **Server:** Server 2 - Clients (207.244.226.234)
> **Repository:** `git@github.com:ConferInc/nutrition-backend.git`
> **API URL:** https://api.nutrismarts.ai

---

## Overview

NutriSmarts Backend is the API server for the NutriSmarts nutrition platform, providing:
- **RESTful API** for meal tracking and nutrition data
- **AI-powered recommendations** via LiteLLM gateway
- **User management** with Appwrite integration
- **Third-party integrations** (fitness devices, health apps)

This is the backend API. See `ConferInc/nutri-b2c` for the frontend.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Express.js |
| **Language** | TypeScript 5 |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Appwrite |
| **AI Gateway** | LiteLLM |
| **Containers** | Docker + Coolify |

---

## Server 2 Environment

### Running Services

| Service | Coolify UUID | Status | Purpose |
|---------|--------------|--------|---------|
| confer-inc/nutrition-backend | `d0c8kogkk0w0ks8k0owo0848` | healthy | Backend API |
| confer-inc/nutri-b2c | `x4o4ooosgo4gcw8s048wok8c` | healthy | B2C Frontend |
| Supabase-Odyssey | `wk8c40o0kokcogw4wksc8s48` | healthy | Database (shared) |
| litellm | `ps0cgcwgwcgkocs8wo48sc8c` | healthy | AI Gateway |

---

## Required Environment Variables

```env
# Server
PORT=3001
NODE_ENV=production

# Database (Supabase)
SUPABASE_URL="https://supabase-url"
SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Appwrite Auth
APPWRITE_ENDPOINT="https://appwrite.endpoint"
APPWRITE_PROJECT_ID="project-id"
APPWRITE_API_KEY="..."

# AI Gateway (LiteLLM)
LITELLM_API_BASE="http://litellm-host:4000"
LITELLM_API_KEY="..."

# External APIs
USDA_API_KEY="..."  # USDA FoodData Central
FITBIT_CLIENT_ID="..."
FITBIT_CLIENT_SECRET="..."
```

---

## Database Schema

### Key Tables

| Table | Purpose |
|-------|---------|
| `users` | User profiles |
| `meals` | Meal entries |
| `meal_items` | Individual food items in meals |
| `nutrition_plans` | Personalized nutrition plans |
| `goals` | Health and fitness goals |
| `progress` | Goal progress tracking |
| `devices` | Connected fitness devices |
| `food_database` | Custom food entries |

---

## Local Development

### Prerequisites

- Node.js >= 20
- npm or pnpm
- Docker for local Supabase

### Quick Start

```bash
# Clone repository
git clone git@github.com:ConferInc/nutrition-backend.git
cd nutrition-backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Start local Supabase
docker compose up -d

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

### NPM Scripts

```bash
# Development
npm run dev          # Start with hot reload
npm run lint         # Run ESLint

# Database
npm run db:migrate   # Run migrations
npm run db:seed      # Seed demo data

# Build
npm run build        # Build for production
npm run start        # Start production server

# Testing
npm run test         # Run tests
```

---

## API Endpoints

### Core Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/meals` | List user meals |
| POST | `/api/v1/meals` | Create meal entry |
| GET | `/api/v1/plans` | Get nutrition plan |
| POST | `/api/v1/ai/recommend` | Get AI recommendations |
| GET | `/api/v1/goals` | List user goals |
| POST | `/api/v1/sync/fitbit` | Sync Fitbit data |

---

## Project Structure

```
nutrition-backend/
├── src/
│   ├── routes/               # API route handlers
│   │   ├── meals.ts
│   │   ├── plans.ts
│   │   ├── goals.ts
│   │   ├── ai.ts
│   │   └── sync.ts
│   ├── services/             # Business logic
│   │   ├── nutrition.ts
│   │   ├── ai.ts
│   │   └── integrations/
│   ├── middleware/           # Express middleware
│   │   ├── auth.ts
│   │   └── validation.ts
│   ├── db/                   # Database client
│   └── types/                # TypeScript definitions
├── migrations/               # Database migrations
├── docker-compose.yml        # Local development
└── Dockerfile                # Production build
```

---

## Coolify Management

```bash
# List apps on Server 2
coolify --context server2 app list

# Restart backend
coolify --context server2 app restart d0c8kogkk0w0ks8k0owo0848

# View logs
coolify --context server2 app logs d0c8kogkk0w0ks8k0owo0848

# Redeploy
coolify --context server2 deploy uuid d0c8kogkk0w0ks8k0owo0848
```

---

## Related Repositories

- **Frontend:** `ConferInc/nutri-b2c` - Next.js B2C app

---

## SSH Access (Server 2)

```bash
ssh root@207.244.226.234
# Password: See Tech Secrets
```

---

## Related Documentation

- **Coolify Infrastructure:** See Obsidian `Coolify-Infrastructure.md`
- **Tech Secrets:** See Obsidian `Secrets/Tech Secrets.md` for credentials

---

*Document created April 11, 2026 for AI agent infrastructure context.*
