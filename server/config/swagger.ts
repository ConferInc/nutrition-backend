// server/config/swagger.ts — B2C-027: OpenAPI/Swagger configuration
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Nutri B2C API",
      version: "1.0.0",
      description:
        "Backend API for the Nutri B2C nutrition platform. " +
        "Covers meal planning, grocery lists, recipe analysis, chatbot, " +
        "barcode scanning, notifications, and household management.",
      contact: { name: "ConferInc Engineering" },
    },
    servers: [{ url: "/api/v1", description: "v1 API prefix" }],
    components: {
      securitySchemes: {
        AppwriteJWT: {
          type: "apiKey",
          in: "header",
          name: "X-Appwrite-JWT",
          description: "Appwrite session JWT obtained from the frontend SDK",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            status: { type: "integer", example: 400 },
            title: { type: "string", example: "Bad Request" },
            detail: { type: "string" },
            instance: { type: "string" },
          },
        },
      },
    },
    security: [{ AppwriteJWT: [] }],
    tags: [
      { name: "Meal Plans", description: "Generate, list, swap, and manage meal plans" },
      { name: "Meal Log", description: "Daily food logging, water intake, streaks" },
      { name: "Grocery Lists", description: "Generate and manage grocery lists" },
      { name: "Recipes", description: "Browse, search, and manage recipes" },
      { name: "User Recipes", description: "User-created recipe CRUD" },
      { name: "Analyzer", description: "Recipe analysis via text, URL, image, or barcode" },
      { name: "Chat", description: "AI nutrition chatbot" },
      { name: "Scan", description: "Barcode scanning and product lookup" },
      { name: "Notifications", description: "Notification center and triggers" },
      { name: "Nutrition", description: "Nutrition dashboard and daily summaries" },
      { name: "User", description: "User profile and onboarding" },
      { name: "Household", description: "Household and member management" },
      { name: "Household Invites", description: "Invite members to a household" },
      { name: "Household Preferences", description: "Household-level dietary preferences" },
      { name: "Grocery Preferences", description: "Preferred brands and grocery stores" },
      { name: "Health", description: "Health conditions and restrictions" },
      { name: "Ingredient Search", description: "Search ingredients for recipe creation" },
      { name: "Feed", description: "Personalized content feed" },
      { name: "Budget", description: "Household budget management" },
      { name: "Substitutions", description: "Product and ingredient substitutions" },
      { name: "Recipe Meta", description: "Recipe ratings, favorites, collections" },
      { name: "Taxonomy", description: "Cuisines, diet types, allergens" },
      { name: "Sync", description: "Profile sync with Appwrite" },
      { name: "Uploads", description: "Image upload for recipes" },
      { name: "Admin", description: "Admin diagnostics and impersonation" },
      { name: "NPS", description: "Net Promoter Score survey" },
    ],
  },
  apis: ["./server/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
