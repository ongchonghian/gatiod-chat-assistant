# Project guidance for Claude Code

## V2 chat service migration

The V2 chat service is being migrated from a Gemini-driven flow to a deterministic, structured-fact-based assessment orchestrator. **Before working on anything in `src/v2/`, `src/chat/chatServiceV2.ts`, or related areas, read [docs/v2/README.md](docs/v2/README.md).**

The 12 binding architectural decisions in [docs/v2/architecture-decisions.md](docs/v2/architecture-decisions.md) are not optional. If you need to deviate, document the reason and update the decision record.

Sprint tickets (V2-001 onwards) are tracked in [docs/v2/sprints.md](docs/v2/sprints.md).

Known live bugs scheduled for fix during system migration: [docs/v2/policy-fixes.md](docs/v2/policy-fixes.md).

## Core invariants

These hold across the entire V2 codebase:

1. **`extractedFacts` contains only resolved, calculation-grade facts.** Unresolved data lives in `pendingObservations`.
2. **No silent inference of clinical fields.** ROM direction, deficit type, loss type, severity bracket, ASIA grade, diplopia zone, and final PI% must be stated by the doctor or selected from offered chips.
3. **`toolArgBuilder` reads only `extractedFacts`** and validates output via the engine's Zod schema (e.g. `UpperLimbValueSchema.safeParse`) before returning `ok: true`.
4. **Confirmation is a snapshot.** `V2SystemConfirmation.factsHash` must equal `hashExtractedFacts(currentFacts)` at execution time.
5. **No silent fallback to legacy after a confirmed V2 failure.** Failures are visible, audited, and require explicit doctor choice.
6. **`src/v2/systemRegistry.ts` is the only source of truth** for which systems are `structured_live`. `policyEngine.ts` and `chatServiceV2.ts` import from it.
7. **Final PI% language requires successful `assess_*` tool evidence.** Lookup responses may show table values but must not use final/system-generated PI wording.
