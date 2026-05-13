# Domain Docs

How engineering skills should consume this repo's domain documentation.

## Before exploring, read these

1. `CONTEXT.md` at the repo root — system-wide GATIOD clinical vocabulary.
2. `CONTEXT-MAP.md` — identifies the four domain contexts and where their per-context docs live.
3. The per-context `CONTEXT.md` for whichever context you're working in:
   - `src/engine/CONTEXT.md` — engine rules, schemas, CVC
   - `src/v2/CONTEXT.md` — V2 pipeline contracts, state machine, structured extraction
   - `src/chat/CONTEXT.md` — chat orchestration, session lifecycle, legacy/V2 routing
   - `src/rag/CONTEXT.md` — dictionary retrieval, synonym expansion
4. `docs/adr/` — system-wide architectural decisions (span multiple contexts).
5. Context-scoped ADRs: `src/<context>/docs/adr/` when they exist.

If any of these files don't exist, proceed silently — `/grill-with-docs` creates them lazily.

## File structure

```
/
├── CONTEXT.md                          ← system-wide vocabulary
├── CONTEXT-MAP.md                      ← index of the four contexts
├── docs/adr/                           ← system-wide decisions
└── src/
    ├── engine/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    ├── v2/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    ├── chat/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    └── rag/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

Use terms as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids. If a concept isn't in the glossary yet, note it for `/grill-with-docs`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (structured-live promotion gate) — but worth reopening because…_
