import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Loads `.env` once before all tests so opt-in runners (e.g.
    // GATIOD_RUN_SEMANTIC_SHADOW=true) can read GEMINI_API_KEY without each
    // test calling `dotenv.config()` themselves. No effect on default CI.
    setupFiles: ["tests/setup.ts"],
  },
});
