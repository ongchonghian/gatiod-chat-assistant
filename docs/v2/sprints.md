# V2 Sprint Plan

Each sprint migrates one or two body systems from legacy to `structured_live`. The pattern is the same per system: build the four capability components (extractor, readiness validator, arg builder, result renderer), wire them into the registry, write golden tests, then flip the registry mode.

Refer to [architecture-decisions.md](architecture-decisions.md) for the binding decisions all sprints must follow.

---

## Sprint 1 — Foundations + Upper Limb (current)

**Goal:** Make V2 authoritative for upper-limb ROM-only and ROM+nerve-gate cases.

**Scope:** This sprint adds the V2 framework AND the first migrated system. Subsequent sprints reuse the framework.

### Tickets

| Ticket | Output |
|---|---|
| **V2-001** | Add `extractedFacts`, `pendingObservations`, `confirmation` to `V2SystemState`. Update `V2SessionState` accordingly. Add migration-safe loader for old sessions (treat missing fields as empty/`not_confirmed`). |
| **V2-002** | Build `src/v2/systemRegistry.ts` with `SystemMigrationMode`, `V2SystemCapability`, `isStructuredLiveSystem`, `requireStructuredCapability`, and `validateSystemRegistry`. All systems start as `"legacy"`. Wire `validateSystemRegistry()` into server startup. |
| **V2-003** | Add upper-limb structured extractor (`src/v2/extractors/upperLimb.ts`). Output `StructuredExtractionResult { extractedFactsPatch, pendingObservationsToAdd, pendingObservationsToResolve, slotSignalsPatch, displayValuesPatch, warnings }`. Slot signals derived from extraction output, not independently regex-derived. |
| **V2-004** | Add upper-limb fact-patch logic for structured facts. Handle side correction, ROM correction, nerve negation, "no other findings", `rom_from_nerve` gate. Edits invalidate `confirmation` (set `status: "stale"`, clear `piPercent`). |
| **V2-005** | Add `validateUpperLimbReadiness(systemState)`. Check `pendingObservations.length === 0`, then `extractedFacts` completeness. Implements the ROM-from-nerve gate when both ROM and neurological facts present. |
| **V2-006** | Add `buildUpperLimbArgs(facts)`. Explicit zero-fills, `UpperLimbValueSchema.safeParse` validation, provenance object. Refuses on missing side or schema failure. |
| **V2-007** | Wire pre-policy guards into `chatServiceV2.ts`: (a) pending-observation resolver gate before grounding/route, (b) extraction-skip when `confirmationReply && pendingConfirmation`. Branch extraction by registry mode. |
| **V2-008** | Modify `policyEngine.ts` confirmation branch (lines 81–96). For `structured_live` systems: run readiness, factsHash check, arg builder, return `execute_tools` with validated args + provenance. For unmigrated: keep `delegate_legacy`. |
| **V2-009** | Add deterministic upper-limb result renderer. Progressive: summary by default, auto-expand on DBE/ROM conflict, amputation suppression, multi-stream CVC, cap applied, doctor PI deviation. Always returns full breakdown object in API response. |
| **V2-010** | Add no-tool-no-PI guard. Two layers: typed `V2RenderedResponse` validator for V2 paths, regex guard retained for legacy `processChat` output. |
| **V2-011** | Add V2 failure path. `V2FailureResponse` type, `renderV2Failure()`, audit events (`v2_failure`, `v2_failure_user_choice`, `v2_legacy_fallback_requested`, `v2_legacy_fallback_result`). Build fallback prompt that includes confirmed V2 summary. |
| **V2-012** | Add 20+ upper-limb golden tests covering: ROM-only, ROM+correction, ROM+nerve gate, side swap, "no other findings", bare-angle clarification, stale confirmation, schema-validation failure, and the full failure choice flow. |
| **V2-013** | Hide debug payload (route, grounding, toolPlan, policy) unless `GATIOD_DEBUG_RESPONSES === "true"`. |
| **V2-014** | Flip `upper_limb` registry mode to `"structured_live"`. Verify `validateSystemRegistry()` passes. Smoke-test in shadow first, then flip default. |

### Acceptance criteria

- User confirms upper-limb ROM case → V2 calls `assess_upper_limb` directly (not via legacy).
- Missing required field after confirmation → V2 asks blocking clarification; no calculation.
- Tool args fail Zod validation → V2 returns `V2FailureResponse{ failureKind: "schema_validation_failed" }`.
- Tool execution succeeds → result renderer produces summary; full breakdown available; `piPercent` stored in V2 state.
- `"left shoulder 90 degrees"` → does not show confirmation; asks direction with chips.
- Edit after confirmation → confirmation goes `"stale"`; rebuild required before tool execution.

---

## Sprint 2 — Lower Limb

**Goal:** Migrate lower limb to `structured_live`. Reuses the framework from sprint 1.

### Tickets

| Ticket | Output |
|---|---|
| **V2-101** | Add lower-limb structured extractor. Inputs: side, joint (hip/knee/ankle/subtalar/great toe), ROM directions per joint, ankylosis, shortening (cm), nerve, amputation, DBE. |
| **V2-102** | Add lower-limb readiness validator. Includes ROM-from-nerve gate, shortening-cm threshold for inclusion. |
| **V2-103** | Add `buildLowerLimbArgs`. Explicit zero values, `LowerLimbValueSchema.safeParse`, provenance. |
| **V2-104** | Add lower-limb result renderer (progressive, exception auto-expand). |
| **V2-105** | Add 20+ lower-limb golden tests (ROM-only, shortening, ankylosis, nerve gate, amputation level). |
| **V2-106** | Flip `lower_limb` registry mode to `"structured_live"`. Verify startup passes. Shadow → default. |

---

## Sprint 3 — Spine

**Goal:** Migrate spine to `structured_live`.

### Tickets

| Ticket | Output |
|---|---|
| **V2-201** | Add spine structured extractor. Inputs: region (cervical/thoracic/lumbar/lumbosacral), diagnosis category (fracture/dislocation/cord injury/cauda equina/disc/spondylolysis/spondylolisthesis/chronic pain), severity bracket, ASIA grade, monoparesis flag, fracture height-loss, neurological (bladder/bowel/sexual/spasms/pressure sores — these *are* correct for spine, unlike CNS Section B). |
| **V2-202** | Add spine readiness validator. ASIA→monoparesis gate, severity-key requirement per diagnosis category. |
| **V2-203** | Add `buildSpineArgs`. Map V2 facts to engine enum (severityKey, monoparesisHalving, etc.). Existing `handleAssessSpine` already maps tool args; align with that shape. |
| **V2-204** | Add spine result renderer. |
| **V2-205** | Add 20+ spine golden tests. Include cauda equina, monoparesis, fracture height-loss thresholds. |
| **V2-206** | Flip `spine` registry mode to `"structured_live"`. |

**End of sprint 3:** Reaches Stage 3 in [rollout-plan.md](rollout-plan.md) — V2 default for upper limb + lower limb + spine.

---

## Sprint 4 — Respiratory + Renal

**Goal:** Migrate two simpler systems together. Both have well-defined input schemas with no clinical-judgement gates.

### Tickets

| Ticket | Output |
|---|---|
| **V2-301** | Respiratory structured extractor (FEV1, FVC, severity class). |
| **V2-302** | Respiratory readiness validator + arg builder + renderer. |
| **V2-303** | Renal structured extractor. **Apply [policy-fixes.md](policy-fixes.md) §4** — ask for `serumCreatinine` / `creatinineClearance` / `ckdStage` / `clinicalSeverity`, NOT eGFR. Engine has no eGFR field. |
| **V2-304** | Renal readiness validator + arg builder + renderer. Validate against `RenalValueSchema`. |
| **V2-305** | Golden tests for both systems (15+ each). |
| **V2-306** | Flip `respiratory` and `renal` to `"structured_live"`. |

---

## Sprint 5 — Gastro-digestive + Hearing

**Goal:** Migrate gastro and hearing.

### Tickets

| Ticket | Output |
|---|---|
| **V2-401** | Gastro structured extractor. **Apply [policy-fixes.md](policy-fixes.md) §3** — subsystem chips must include upper GI, colon/rectum/anus, liver/biliary, **and hernia**. Current slot policy at `slotEvaluator.ts:409` is missing upper GI and hernia. |
| **V2-402** | Gastro readiness + arg builder + renderer. |
| **V2-403** | Hearing structured extractor (audiogram values per ear, frequencies, hearing aids). |
| **V2-404** | Hearing readiness + arg builder + renderer. |
| **V2-405** | Golden tests for both (15+ each). Include hernia routing. |
| **V2-406** | Flip both to `"structured_live"`. |

---

## Sprint 6 — CNS + Visual (most complex; biggest policy fixes)

**Goal:** Migrate CNS and visual. These are the systems with the largest pre-existing slot-policy mismatches. Schedule last because the fixes are the most disruptive to current behaviour.

### Tickets

| Ticket | Output |
|---|---|
| **V2-501** | CNS structured extractor. **Apply [policy-fixes.md](policy-fixes.md) §1** — Section B components must be olfaction / facial nerve / equilibrium / swallowing / station-gait / respiration. Current slot policy at `slotEvaluator.ts:493` asks bladder/bowel/sexual/spasms/pressure sores (those are spine complications, not CNS-B). Update both `section_b_component` signal regex (line 129) and the slot policy chips. |
| **V2-502** | CNS Section A and Section C extractors (epilepsy/dementia/psychiatric for A; paralysis brackets for C). |
| **V2-503** | CNS readiness + arg builder + renderer. |
| **V2-504** | Visual structured extractor. **Apply [policy-fixes.md](policy-fixes.md) §2** — diplopia chips must be uncorrectable / central 30° / 30–60° / beyond 60° / none, NOT monocular/binocular. Current slot policy at `slotEvaluator.ts:538` is wrong. |
| **V2-505** | Visual readiness + arg builder + renderer. Visual acuity per eye, visual field, diplopia zone. |
| **V2-506** | Golden tests for both (25+ each — these are the most complex). |
| **V2-507** | Flip `cns` and `visual` to `"structured_live"`. |

**End of sprint 6:** Reaches Stage 4 in [rollout-plan.md](rollout-plan.md) — V2 default for all systems.

---

## Sprint 7 — Hardening + Legacy disable

**Goal:** Reach Stage 5 — legacy disabled except admin/fallback.

### Tickets

| Ticket | Output |
|---|---|
| **V2-601** | Audit dashboard for `v2_failure` and `v2_legacy_fallback_requested` events. Identify systems with persistent fallback rates. |
| **V2-602** | Add admin override route (`/api/chat/legacy`) for explicit legacy invocation. Default `/api/chat` becomes V2-only. |
| **V2-603** | Disable `delegate_legacy` for all `structured_live` systems in `policyEngine.ts`. Unmigrated paths only allowed for systems still marked `legacy` (which should be empty by sprint 7). |
| **V2-604** | Remove `extractValues()` and `extractSignals()` from the live pipeline; delete the legacy extraction call sites. Keep functions exported for one release for any straggler callers, then delete. |
| **V2-605** | Final regression suite: 100+ end-to-end conversations covering every system. |

---

## Pattern for any new system migration

When migrating system `X` after sprint 1:

1. Build extractor (`src/v2/extractors/<X>.ts`) — enforces D2 inference boundary.
2. Build readiness validator (`src/v2/readiness/<X>.ts`).
3. Build arg builder (`src/v2/argBuilders/<X>.ts`) — uses engine's Zod schema.
4. Build result renderer (`src/v2/renderers/<X>Result.ts`) — progressive per D9.
5. Apply any [policy-fixes.md](policy-fixes.md) entries for that system.
6. Add 15–25 golden tests in `tests/v2/<X>/`.
7. Update `V2_SYSTEM_REGISTRY[X]` to wire the four components, mode stays `"legacy"`.
8. Run in `"structured_shadow"` mode for at least one release cycle. Compare shadow output vs legacy in audit logs.
9. Flip mode to `"structured_live"`. Verify `validateSystemRegistry()` passes at startup.
10. Update [rollout-plan.md](rollout-plan.md) stage if appropriate.
