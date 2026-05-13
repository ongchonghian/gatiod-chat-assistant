# V2 Chat Service — Design & Sprint Documentation

This directory holds the architectural decisions and sprint plans for migrating the GATIOD chat assistant from the legacy Gemini-driven flow to V2: a deterministic, structured-fact-based assessment orchestrator.

## Index

| Doc | Purpose |
|---|---|
| [architecture-decisions.md](architecture-decisions.md) | The 12 binding architectural decisions reached during planning. Read this first. |
| [sprints.md](sprints.md) | Sprint-by-sprint breakdown. Sprint 1 is upper limb; subsequent sprints follow the same template per system. |
| [policy-fixes.md](policy-fixes.md) | Confirmed bugs in current V2 slot policy (CNS Section B, visual diplopia, gastro subsystem, renal eGFR). |
| [rollout-plan.md](rollout-plan.md) | The five-stage rollout, promotion gates, and shadow-mode invariants. |
| [shadow-to-live.md](shadow-to-live.md) | Shadow mode purpose, the full legacy → shadow → live process, all gating criteria, and the pre-switch checklist. |
| [requirements-known-issues.md](requirements-known-issues.md) | Open `REQ-*` items not yet closed by a sprint ticket. Verified by `npm run docs:verify` — every `REQ-*` must be referenced in [sprints.md](sprints.md). |

## Core invariants

These hold across every sprint and every system. If a change violates one, stop.

1. **`extractedFacts` contains only resolved, calculation-grade facts.** Unresolved data lives in `pendingObservations`.
2. **No silent inference of clinical fields.** ROM direction, deficit type, loss type, severity bracket, ASIA grade, diplopia zone, and final PI% must be stated by the doctor or selected from offered chips.
3. **`toolArgBuilder` reads only `extractedFacts`.** It must validate output via the engine's Zod schema (e.g. `UpperLimbValueSchema.safeParse`) before returning `ok: true`.
4. **Confirmation is a snapshot.** `V2SystemConfirmation.factsHash` must equal `hashExtractedFacts(currentFacts)` at execution time.
5. **No silent fallback to legacy after a confirmed V2 failure.** Failures are visible, audited, and require explicit doctor choice to fall back.
6. **Single source of truth for migration state.** `src/v2/systemRegistry.ts` is the only place that knows which systems are `structured_live`. `policyEngine.ts` and `chatServiceV2.ts` import from it.
7. **Final PI% language requires successful `assess_*` tool evidence.** Lookup responses may show table values but must not use final/system-generated PI wording.

## Where to start

- New to the project? Read [architecture-decisions.md](architecture-decisions.md) end-to-end.
- Picking up a sprint ticket? Read the sprint section in [sprints.md](sprints.md), then the relevant decisions referenced from it.
- Promoting a system? Read [rollout-plan.md](rollout-plan.md) before flipping the registry.
