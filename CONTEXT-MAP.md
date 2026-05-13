# Context Map

This repo is split into four domain contexts. Each has its own `CONTEXT.md` and `docs/adr/`.
The root `CONTEXT.md` contains system-wide vocabulary (GATIOD clinical terms, PI%, CVC, etc.)
that applies across all contexts.

| Context | Path | Domain |
|---|---|---|
| engine | `src/engine/` | GATIOD assessment rules, 9 body systems, CVC composition, Zod schemas |
| v2 | `src/v2/` | V2 structured pipeline: contracts, state machine, extractors, readiness, arg builders, renderers, consensus, policy engine |
| chat | `src/chat/` | Chat orchestration: legacy Gemini flow, V2 chat service, session management, system prompt |
| rag | `src/rag/` | GATIOD dictionary retrieval, keyword search, claimsDex RAG adapter |

Per-context files (created lazily by `/grill-with-docs`):
- `src/engine/CONTEXT.md` + `src/engine/docs/adr/`
- `src/v2/CONTEXT.md` + `src/v2/docs/adr/`
- `src/chat/CONTEXT.md` + `src/chat/docs/adr/`
- `src/rag/CONTEXT.md` + `src/rag/docs/adr/`

System-wide ADRs (span multiple contexts) live in `docs/adr/`.

## Relationships

- **rag → v2**: The hybrid retriever produces a `GroundingResult` consumed by the V2 router and semantic interpreter. RAG is stateless and has no upstream dependency on v2.
- **v2 → engine**: Arg builders produce validated tool arguments; the V2 pipeline calls the engine via tool handlers. The engine is a pure-function layer with no knowledge of v2.
- **chat → v2**: `chatServiceV2.ts` orchestrates the entire V2 pipeline — it is the entry point that calls into rag, v2, and engine in sequence.
- **chat → engine** (legacy path only): The legacy flow calls tool handlers directly (bypassing v2 extractors/readiness); tool handlers call the engine.
- **v2 ↔ engine**: The v2 arg builders validate against the engine's Zod schemas (`<System>ValueSchema.safeParse`) without importing engine calculation functions.
