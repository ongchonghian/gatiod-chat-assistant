// Test setup — runs once before all vitest tests.
//
// Loads `.env` so opt-in tests that talk to real APIs (e.g. the semantic
// shadow runner gated by GATIOD_RUN_SEMANTIC_SHADOW=true) can read
// GEMINI_API_KEY from the developer's local environment file. Has no
// effect on default CI tests, which never read GEMINI_API_KEY.
import "dotenv/config";
