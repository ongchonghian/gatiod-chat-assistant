# GATIOD Chat Assessment Assistant

Conversational front-end to AcuScore's GATIOD calculation engine. Doctors describe clinical findings naturally; the LLM extracts structured data and calls deterministic calculation tools. **The LLM never does math.**

## Architecture

```
Doctor ↔ Chat UI ↔ Gemini (LLM) ↔ Tool Functions ↔ AcuScore Calculation Engine
                       ↑                                      ↑
                  System Prompt                        upperLimbData.ts
                  (interview logic)                    cvcCalculator.ts
                       ↑
                      RAG
                  (dictionary, chapters)
```

## Quick Start

```bash
npm install
GEMINI_API_KEY=your-key-here npm run dev
```

The server runs on `http://localhost:3001`.

### API

- `POST /api/chat` — Send a message. Body: `{ "message": "...", "sessionId": "..." }`
- `POST /api/chat/reset` — Clear session. Body: `{ "sessionId": "..." }`
- `GET /health` — Health check

### Example

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Left shoulder, flexion limited to 120 degrees, abduction to 90. Suprascapular nerve damage, combined, partial loss."}'
```

## MVP Scope

- **Upper Limb only** (Chapter 3) — the most complex GATIOD system
- 6 tools: `assess_upper_limb`, `lookup_rom_table`, `lookup_amputation_level`, `lookup_nerve`, `lookup_dbe_condition`, `search_dictionary`
- Mandatory confirmation step before calculation
- Structured breakdown output

## Project Structure

```
src/
├── engine/          # Extracted AcuScore calculation modules (pure TS)
├── tools/           # LLM tool schemas and handlers
├── chat/            # System prompt and Gemini orchestration
├── rag/             # Dictionary search
├── api/             # Express routes
└── server.ts        # Entry point
knowledge/
├── dictionary.json  # 592-entry GATIOD dictionary
tests/
└── engine/          # Calculation validation tests
```

## Portability to claimsDex

This project is designed for easy integration into the claimsDex platform:
- `engine/` → import into claimsDex backend
- `tools/` + `chat/` → integrate with existing `chatService.ts`
- `rag/` → merge with `gatiodHybridRetriever.ts`

## Testing

```bash
npm test              # Run all tests
npm run test:engine   # Engine tests only
npm run lint          # TypeScript type check
```
