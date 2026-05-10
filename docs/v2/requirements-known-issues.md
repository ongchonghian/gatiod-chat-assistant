# V2 Known-Issue Requirements

This document records detailed requirements to close every known gap in the V2 system as of 2026-05-11. Each requirement has a root-cause pointer, acceptance criteria, and a suggested sprint mapping. All requirements must be consistent with the binding decisions in [architecture-decisions.md](architecture-decisions.md).

---

## Categories

| Category | Count | Priority |
|---|---|---|
| A — Missing system migrations (CNS, Visual) | 6 reqs | Highest |
| B — Promotion gate / calibration infrastructure | 4 reqs | High |
| C — Golden test shortfalls | 3 reqs | High |
| D — Legacy pipeline coupling | 3 reqs | Medium |
| E — Loop guard + failure path | 2 reqs | Medium |
| F — Operational readiness | 2 reqs | Medium |

---

## A — Missing system migrations (CNS, Visual)

### REQ-A1 — CNS structured extractor

**Problem:** `cns` is `mode: "legacy"` in `systemRegistry.ts:176`. There is no `extractCns` function. Assessments for epilepsy, dementia, psychiatric disorders (Section A), olfaction/facial nerve/equilibrium/swallowing/station-gait/respiration (Section B), and paralysis brackets (Section C) are handled exclusively by the legacy Gemini flow. This flow can silently infer Section B components or use the wrong component set.

**Root cause:** Sprint 6 (V2-501, V2-502) has not been executed.

**Acceptance criteria:**

1. `src/v2/extractors/cns.ts` exists and exports `extractCns(utterance, systemState)`.
2. Section A: extracts epilepsy group (group 1/2/3/4), dementia class (1/2/3), and psychiatric group (specialist-confirmed, not specialist-confirmed). Each is a `PendingObservation` when stated without a group/class; graduates to `extractedFacts` once the chip selection is received.
3. Section B: extracts component as one of `olfaction | facial_nerve | equilibrium | swallowing | station_gait | respiration`. Any input matching the old spine-complication terms (`bladder`, `bowel`, `sexual`, `spasms`, `pressure sores`) creates a `PendingObservation` with clarification question: *"This looks like a spine neurological complication — did you mean olfaction, facial nerve, equilibrium, swallowing, station/gait, or respiration?"*. Does **not** silently map to a Section B component.
4. Section C: extracts number of paralysed limbs (1, 2, 3, 4) and identifies monoplegia/paraplegia/tetraplegia/hemiplegia as aliases. ASIA grade is not applicable here; do not prompt for it.
5. Signal regex `section_b_component` in `slotEvaluator.ts:128` already uses the correct pattern — the extractor must use the same accepted values.
6. Extractor produces `StructuredExtractionResult` shape; no facts written to `extractedFacts` without an extraction method of `"regex"` or `"user_selected"`.

**Files to create/modify:** `src/v2/extractors/cns.ts` (create), `src/v2/systemRegistry.ts` (wire, keep mode `"legacy"` until REQ-A3 is done).

---

### REQ-A2 — CNS readiness validator, arg builder, result renderer

**Problem:** No `validateCnsReadiness`, `buildCnsArgs`, or `renderCnsResult` exists. The system cannot progress from extraction to calculation.

**Root cause:** Sprint 6 (V2-503) not executed.

**Acceptance criteria:**

1. `src/v2/readiness/cns.ts` exports `validateCnsReadiness(systemState)`.
   - Returns `ready: false` with `reason: "pending_observations"` if any pending observations exist.
   - Section A path: requires section group/class AND specialist confirmation flag.
   - Section B path: requires component key AND bracket.
   - Section C path: requires paralysed-limb count.
   - When section is ambiguous, asks: *"Which CNS section applies: Section A (epilepsy/dementia/psychiatric), Section B (cranial nerve), or Section C (paralysis)?"* with chips.
   - Declares `expectedAnswer` on all enum-typed clarifications (D14) so the generic resolver can graduate them.
2. `src/v2/argBuilders/cns.ts` exports `buildCnsArgs(facts)`.
   - Validates against `CnsValueSchema.safeParse` before returning `ok: true`.
   - Never defaults section or group — both are required clinical facts (D7).
3. `src/v2/renderers/cnsResult.ts` exports `renderCnsResult(toolResult, systemState)`.
   - Progressive per D9; auto-expands when specialist confirmation was required.
   - Returns `AssessmentRenderResult` shape.
4. `src/v2/systemRegistry.ts`: wires all four components but keeps mode `"legacy"` until REQ-A3.

**Files to create:** `src/v2/readiness/cns.ts`, `src/v2/argBuilders/cns.ts`, `src/v2/renderers/cnsResult.ts`.

---

### REQ-A3 — CNS golden tests and registry flip

**Problem:** No CNS V2 golden tests. Cannot verify end-to-end correctness before promoting to `structured_live`.

**Root cause:** Sprint 6 (V2-506, V2-507) not executed.

**Acceptance criteria:**

1. `tests/v2/cns/extractor.test.ts`: 25+ extractor unit tests. Must cover:
   - Section A epilepsy group 1/2/3/4 extraction.
   - Section B with each of the six correct components.
   - Section B with old spine-complication terms (`bladder`, `bowel`) → produces a pending observation, not a fact.
   - Section C with each limb count (1–4) and aliases.
   - Multi-section utterance (e.g. section A + B in the same text) → correctly partitions.
2. `tests/v2/cns/readinessAndArgBuilder.test.ts`: 15+ tests.
   - Ready state for each section path.
   - `buildCnsArgs` validates against engine schema on at least 10 fact configurations.
   - Schema failure → `ok: false` with Zod issue messages.
3. Shadow mode run: set `spine.mode = "structured_shadow"` for cns in a staging environment, compare against legacy for one release cycle. Shadow divergence above 5% blocks promotion (per rollout-plan.md).
4. `V2_SYSTEM_REGISTRY.cns.mode` flipped to `"structured_live"` only after all tests pass and shadow comparison is clean.
5. `validateSystemRegistry()` passes at server startup after the flip.

**Files to create:** `tests/v2/cns/extractor.test.ts`, `tests/v2/cns/readinessAndArgBuilder.test.ts`. **Files to modify:** `src/v2/systemRegistry.ts`.

---

### REQ-A4 — Visual structured extractor

**Problem:** `visual` is `mode: "legacy"` in `systemRegistry.ts:177`. Diplopia zone chips have already been fixed in `slotEvaluator.ts:141–142` (correct zones: uncorrectable/central 30°/30–60°/beyond 60°/none), but the structured extractor that enforces this during `structured_live` does not exist.

**Root cause:** Sprint 6 (V2-504) not executed.

**Acceptance criteria:**

1. `src/v2/extractors/visual.ts` exists and exports `extractVisual(utterance, systemState)`.
2. Extracts per-eye visual acuity (fraction form: `6/6`, `6/12`, `6/60`; snellen and metric). Left eye and right eye are separate facts. No cross-eye inference.
3. Extracts visual field defect type. Does not infer percentage loss from narrative alone.
4. Extracts diplopia zone as one of `"none" | "uncorrectable" | "central_30" | "30_to_60" | "beyond_60"`. Input of `"monocular"` or `"binocular"` → `PendingObservation` with clarification: *"Is the diplopia uncorrectable, within the central 30°, 30–60°, or beyond 60°?"* with zone chips. Does **not** silently map monocular/binocular to a zone.
5. Extracts modifiers: dominant eye, non-dominant eye, enucleation, prosthetic eye.
6. Per D2 inference boundary: diplopia zone, visual field defect type, and dominant-eye designation may **not** be inferred — they must be stated or chip-selected.

**Files to create:** `src/v2/extractors/visual.ts`. **Files to modify:** `src/v2/systemRegistry.ts` (wire extractor, keep mode `"legacy"`).

---

### REQ-A5 — Visual readiness validator, arg builder, result renderer

**Problem:** Same gap as REQ-A2 but for visual.

**Root cause:** Sprint 6 (V2-505) not executed.

**Acceptance criteria:**

1. `src/v2/readiness/visual.ts` exports `validateVisualReadiness(systemState)`.
   - Requires at least one eye's acuity, OR a visual field defect, OR a diplopia zone.
   - If diplopia is mentioned but zone is unknown: blocks with zone clarification question + chips.
   - If dominant eye is unspecified when one eye is absent/prosthetic: blocks with dominant-eye question.
   - Declares `expectedAnswer` on all enum-typed questions (D14).
2. `src/v2/argBuilders/visual.ts` exports `buildVisualArgs(facts)`.
   - Validates against `VisualValueSchema.safeParse`.
   - Requires diplopia zone to be a zone enum value, not `"monocular"` or `"binocular"` — returns `ok: false` if old format reaches the builder.
3. `src/v2/renderers/visualResult.ts` exports `renderVisualResult(toolResult, systemState)`.
   - Progressive per D9; auto-expands when diplopia conflict or bilateral involvement is present.

**Files to create:** `src/v2/readiness/visual.ts`, `src/v2/argBuilders/visual.ts`, `src/v2/renderers/visualResult.ts`.

---

### REQ-A6 — Visual golden tests and registry flip

**Problem:** No visual V2 golden tests. Cannot promote to `structured_live` without them.

**Root cause:** Sprint 6 (V2-506, V2-507) not executed.

**Acceptance criteria:**

1. `tests/v2/visual/extractor.test.ts`: 25+ extractor tests. Must cover:
   - Bilateral acuity extraction (both eyes in one utterance).
   - Diplopia zone extraction with each valid zone phrase.
   - `"monocular"` / `"binocular"` input → pending observation, not a fact.
   - Enucleation / prosthetic eye modifier.
   - Visual field defect — type stated vs unstated.
2. `tests/v2/visual/readinessAndArgBuilder.test.ts`: 15+ tests covering schema validation.
3. Shadow mode run for at least one release cycle before flip.
4. `V2_SYSTEM_REGISTRY.visual.mode` flipped to `"structured_live"` after all gates pass.

**Files to create:** `tests/v2/visual/extractor.test.ts`, `tests/v2/visual/readinessAndArgBuilder.test.ts`. **Files to modify:** `src/v2/systemRegistry.ts`.

---

## B — Promotion gate / calibration infrastructure

### REQ-B1 — Excel shadow runner (calibration evidence infrastructure)

**Problem:** `validateStructuredLivePromotion()` in `systemRegistry.ts:266` has two operating modes: allowlist mode (no evidence reader) and evidence mode (with reader). It currently always runs in allowlist mode because no evidence reader implementation exists. All 7 structured_live systems are on `PROVISIONAL_STRUCTURED_LIVE` (`systemRegistry.ts:202–210`). The per-system ADR-0001 thresholds at `systemRegistry.ts:234–244` are defined but never enforced at CI time.

**Root cause:** Evidence reader (slice 32 reference) has not been built. The calibration runner that produces `SystemCalibrationReport` records is not wired.

**Acceptance criteria:**

1. A calibration runner exists (location: `scripts/calibration/` or `tests/v2/excelScenarios/`) that:
   - Reads `.xlsx` workbook files from a configurable directory.
   - For each row, runs the full V2 extraction → readiness → argBuilder → (mocked) tool call chain.
   - Records `sampleSize`, `componentSafeOutcomeRate`, and `exactCalculationRate` per system.
   - Writes a `SystemCalibrationReport` to a JSON artefact (e.g. `calibration-report.json`).
2. A `FileCalibrationEvidenceReader` class implements `PromotionEvidence` and reads from `calibration-report.json`.
3. `validateStructuredLivePromotion(new FileCalibrationEvidenceReader())` is called in CI as a separate check step. Any system below its ADR-0001 threshold causes CI to fail with a clear message citing the system, its rates, and the threshold.
4. The runner is runnable locally: `npx tsx scripts/calibration/run.ts --workbook path/to/workbook.xlsx`.
5. Spine, which is currently at 86.7%/86.7% (below the 95%/90% gate), is expected to fail this check until the extractor is improved (REQ-B2).

**Files to create:** `scripts/calibration/run.ts`, `scripts/calibration/fileCalibrationEvidenceReader.ts`. **Files to modify:** `src/v2/systemRegistry.ts` (no code change needed; the interface is already there).

---

### REQ-B2 — Spine extractor phrasing improvements (calibration recovery)

**Problem:** Spine extractor calibration is 86.7% safe-outcome and 86.7% exact-calculation on a 30-row sample (noted in `systemRegistry.ts:111–118`). The ADR-0001 gate for spine is 95%/90%. Spine is `structured_live` but is provisionally below its own gate.

**Root cause:** The workbook uses natural-language phrasings for severity rows that the current extractor regex does not match. Specifically, fracture height-loss thresholds, cord injury ASIA narrative, and spondylolisthesis grade phrasings have been identified as the failing rows in the calibration notes.

**Acceptance criteria:**

1. Run the calibration runner (REQ-B1) against the spine workbook sheet. Identify every row that produces a `"calibration_required"` or wrong PI% outcome.
2. For each failing row, add a regex pattern to `src/v2/extractors/spine.ts` or update the severity-key resolver to cover the workbook phrasing. Each pattern must be covered by a test in `tests/v2/spine/extractor.test.ts`.
3. After phrasing improvements, re-run calibration. Spine must reach ≥95% safe-outcome AND ≥90% exact-calculation on the same workbook sheet.
4. `PROVISIONAL_STRUCTURED_LIVE` in `systemRegistry.ts` may remove `"spine"` only after the calibration evidence file records rates at or above threshold.
5. No behaviour changes to the extractor that reduce correctness for already-passing rows. Each improvement must be additive.

**Files to modify:** `src/v2/extractors/spine.ts`, `tests/v2/spine/extractor.test.ts`.

---

### REQ-B3 — Hearing curated golden tests and calibration

**Problem:** Hearing is noted as `"must earn full structured_live via curated goldens + Excel shadow thresholds"` in `systemRegistry.ts:167–168`. Hearing extractor tests exist (`tests/v2/hearing/extractor.test.ts`, 287 lines) but there are no conversation-level golden tests and no calibration report.

**Root cause:** Hearing was promoted before the golden test suite and calibration run were completed.

**Acceptance criteria:**

1. `tests/v2/hearing/golden.test.ts` (new): 20+ conversation-level golden scenarios. Must cover:
   - NID path: bilateral AHL + age → correct PI%.
   - NID path: missing age → blocks with age clarification.
   - NID path: presbycusis deduction applied correctly.
   - Injury path: left ear affected → only left AHL required.
   - Injury path: affected ear unknown → blocks before AHL question.
   - Tinnitus present: correctly included vs excluded.
   - AHL value provided by chip selection vs free text.
2. Calibration runner (REQ-B1) run against hearing workbook sheet. Must reach ≥95% safe-outcome and ≥90% exact-calculation.
3. `"hearing"` may be removed from `PROVISIONAL_STRUCTURED_LIVE` only after criteria 1 and 2 are met.

**Files to create:** `tests/v2/hearing/golden.test.ts`.

---

### REQ-B4 — Full calibration passes for remaining provisional systems

**Problem:** `upper_limb`, `lower_limb`, `respiratory`, `renal`, and `gastro_digestive` are all on `PROVISIONAL_STRUCTURED_LIVE`. Each has a defined threshold in `ADR_0001_REGISTRY_THRESHOLDS` (lines 234–244) but no calibration evidence file exists.

**Root cause:** Excel shadow runner (REQ-B1) is a prerequisite.

**Acceptance criteria:** After REQ-B1 is delivered, for each of these systems:

1. Run the calibration runner against the corresponding workbook sheet.
2. Each system must reach or exceed its ADR-0001 threshold:
   - `upper_limb`, `lower_limb`: ≥85% safe-outcome, ≥70% exact-calculation.
   - `respiratory`, `renal`: ≥90% safe-outcome, ≥80% exact-calculation.
   - `gastro_digestive`: ≥85% safe-outcome, ≥70% exact-calculation.
3. Gastro note: the workbook provides PI% as ranges — all rows will classify as `clarification_required` (doctor must pick a value within the bracket). The safe-outcome check must verify the bracket offered is the correct one. Exact-calculation rate is N/A and should not be evaluated for gastro.
4. Each system removed from `PROVISIONAL_STRUCTURED_LIVE` only after its calibration file records rates at or above threshold.

---

## C — Golden test shortfalls

### REQ-C1 — Per-system end-to-end golden test suites

**Problem:** Sprint plan requires 15–25 golden (conversation-level) tests per system. Current state:

| System | Extractor tests | Readiness tests | Conversation golden |
|---|---|---|---|
| upper_limb | yes | yes | partial (guards, pendingObservation) |
| lower_limb | yes | yes | **none** |
| spine | yes | yes | yes (95 lines, ~12 cases) |
| respiratory | yes | yes | **none** |
| renal | yes | yes | **none** |
| gastro_digestive | yes | yes | **none** |
| hearing | yes | yes | **none** (REQ-B3 covers this) |
| cns | none | none | none (REQ-A3 covers this) |
| visual | none | none | none (REQ-A6 covers this) |

**Root cause:** Unit tests were written per-layer (extractor, readiness) but the full conversation-level golden format (utterance sequence → expected extracted facts → expected PI%) was not applied to most systems.

**Acceptance criteria (for each system without a golden suite):**

1. **Lower limb** — `tests/v2/lowerLimb/golden.test.ts`: 15+ scenarios including ROM-only, shortening, ankylosis, nerve gate, amputation level, bilateral.
2. **Respiratory** — `tests/v2/respiratory/golden.test.ts`: 15+ scenarios including PFT-only, occupational asthma (all 3 prerequisites met), asbestosis/silicosis with profusion bands, VO2max path.
3. **Renal** — `tests/v2/renal/golden.test.ts`: 15+ scenarios including serum-creatinine path, creatinine-clearance path, CKD-stage-only, clinical-severity-only, solitary kidney modifier, eGFR disambiguation (→ pending observation, not a fact).
4. **Gastro** — `tests/v2/gastro/golden.test.ts`: 15+ scenarios including each of the 4 subsystems (upper GI, colonic, liver/biliary, hernia), bracket selection, weight-loss modifier for upper GI.
5. **Spine** — expand `tests/v2/spine/spineEndToEnd.test.ts` to 25+ cases: add cauda equina with bladder/bowel complications, monoparesis halving, fracture height-loss thresholds, multi-region guard triggering.

Each golden test must assert: (a) the extracted facts produced, (b) the readiness result after the final utterance, (c) the tool args shape (`buildXArgs` output), (d) the rendered result summary includes the correct PI% or bracket label.

---

### REQ-C2 — No-tool-no-PI guard integration tests

**Problem:** D10 specifies a `validateRenderedResponse` guard. There are no tests verifying that the guard blocks PI% language in `lookup_only` responses across all systems.

**Root cause:** The guard was specified in D10 but per-system integration tests covering the guard were not added when systems were promoted.

**Acceptance criteria:**

1. `tests/v2/guards.test.ts` (or extend existing `tests/v2/upperLimb/guards.test.ts`): one test per system for each of:
   - `lookup_only` response containing "Final PI%: X%" → guard returns `ok: false`.
   - `assessment_result` response without `toolEvidence.success === true` → guard returns `ok: false`.
   - `assessment_result` response with successful `assess_*` tool → guard returns `ok: true`.
2. Tests cover all 9 system keys.
3. The guard path is reachable from the chat service, not just from unit tests. A single integration scenario per system must show that the guard fires before the response is returned to the caller.

---

### REQ-C3 — V2 failure path tests per system

**Problem:** D11 defines the `V2FailureResponse` format and audit events. There are no per-system tests verifying that `readiness_failed`, `stale_confirmation`, `arg_builder_failed`, `schema_validation_failed`, and `tool_execution_failed` produce the correct `V2FailureResponse` shape and the correct audit events.

**Root cause:** The failure renderer was built centrally but was not tested against each system's specific failure modes.

**Acceptance criteria:**

1. For each `structured_live` system, add at least 3 failure-path cases to its test suite:
   - `readiness_failed`: system in collecting state with pending confirmation → confirmation rejected.
   - `schema_validation_failed`: arg builder receives facts that fail `safeParse` → `ok: false` with Zod messages.
   - `stale_confirmation`: facts patched after confirmation → `factsHash` mismatch → `V2FailureResponse{ failureKind: "stale_confirmation" }`.
2. Each failure test asserts: `kind === "v2_failure"`, `failureKind` is correct, `message` is non-empty, `suggestedChips` contains `["Review findings", "Retry structured calculation", "Use legacy mode"]`.
3. Audit event `v2_failure` is emitted with `system` and `failureKind` fields in each case.

---

## D — Legacy pipeline coupling

### REQ-D1 — Remove slotEvaluator from the structured_live path

**Problem:** `chatServiceV2.ts:32` imports `extractSignals`, `extractValues`, and `mergeSignals` from `slotEvaluator.ts`. For systems that are `structured_live`, calling the slotEvaluator alongside the structured extractor creates the split-brain state described in D5: the legacy slot evaluator may mark a signal satisfied while the structured extractor has created a `pendingObservation` for the same field.

**Root cause:** When systems were promoted to `structured_live`, the slotEvaluator calls were not gated out. The `chatServiceV2.ts` pipeline still unconditionally calls `extractSignals` for all systems.

**Acceptance criteria:**

1. In `chatServiceV2.ts`, the `extractSignals(utterance, system)` call for a given system is only executed when `V2_SYSTEM_REGISTRY[system].mode !== "structured_live"`. `structured_live` systems get their signals exclusively from `StructuredExtractionResult.slotSignalsPatch`.
2. `extractValues(utterance, system)` follows the same gate: only called for `legacy` and `structured_shadow` systems.
3. `slotEvaluator.ts` export of slot policies (used by the policy engine for `legacy`-mode systems) is retained and not deleted.
4. No regression: `legacy`-mode systems (cns, visual) still receive slotEvaluator signal extraction.
5. Test: add a unit test that mocks a `structured_live` system and asserts `extractSignals` is never called for it in a full `processChatV2` pass.

**Files to modify:** `src/chat/chatServiceV2.ts`.

---

### REQ-D2 — Sprint 7: admin legacy route

**Problem:** Sprint 7 V2-602 not executed. No `/api/chat/legacy` admin route exists. When V2 is the default for all systems, there is no escape valve for edge cases beyond the doctor-selected fallback in D11.

**Root cause:** Sprint 7 has not started.

**Acceptance criteria:**

1. A route handler exists at `POST /api/chat/legacy` that bypasses the V2 pipeline and calls `processChat` (legacy) directly.
2. The route requires an explicit `x-gatiod-admin: true` header. Requests without the header receive `403`.
3. The route logs an audit event `legacy_admin_route_invoked` with `{ userId, sessionId, reason }`. The `reason` field is required in the request body; requests without it receive `400`.
4. The route is not reachable from the doctor-facing frontend — it is server/admin only.
5. `POST /api/chat` continues to route to V2 for all systems.

**Files to modify:** `src/server.ts` or equivalent route file.

---

### REQ-D3 — Sprint 7: remove extractValues/extractSignals from the live pipeline when all systems are structured_live

**Problem:** Sprint 7 V2-604 specifies removing `extractValues()` and `extractSignals()` from the live pipeline once all systems are `structured_live`. This cannot happen until CNS and visual are migrated (REQ-A1 through REQ-A6), but the removal path must be planned to avoid stale import paths after migration.

**Root cause:** CNS and visual remain `legacy`; removal is blocked.

**Acceptance criteria:**

1. This requirement is a **prerequisite gate**: it must not be implemented until `V2_SYSTEM_REGISTRY.cns.mode === "structured_live"` AND `V2_SYSTEM_REGISTRY.visual.mode === "structured_live"`.
2. Once the gate is met: remove all calls to `extractValues()` and `extractSignals()` from `chatServiceV2.ts`. Do not remove the functions from `slotEvaluator.ts` in the same PR — keep them exported for one release cycle so any missed callers fail loudly at import time, then delete in a follow-up PR.
3. `slotEvaluator.ts` slot-policy objects (the `SLOT_POLICIES` record) are retained until a separate decision removes the legacy fallback path entirely (Sprint 7 V2-603 → V2-605).
4. After removal, `chatServiceV2.ts` must have zero imports from `slotEvaluator.ts`. CI must enforce this with a lint rule or import boundary check.

---

## E — Loop guard + failure path

### REQ-E1 — D17 per-turn loop guard

**Problem:** D17 describes a per-turn state-progression guard that hashes the relevant state slice before and after each gate (pending-observation → consensus → router → policy → confirmation → handoff → CVC offer) and aborts with an explicit "no progress" diagnostic when no slice changes after a full pass. Four cross-system test timeouts in issue #12 were attributed to the absence of this guard. D17 is marked deferred but is recommended as gate count grows.

**Root cause:** Deferred in D17; complexity was acceptable at the time but issue #12 RC timeouts show the risk is real.

**Acceptance criteria:**

1. A `detectNoProgress(stateBefore, stateAfter, gate)` utility exists in `src/v2/stateMachine.ts` or a dedicated `src/v2/loopGuard.ts`.
2. It computes a deterministic hash of the parts of `V2SessionState` that are expected to change at a given gate: `pendingObservations`, `extractedFacts`, `pendingConfirmation`, `pendingConsensus`, `claimComponentOverrides`.
3. In `chatServiceV2.ts`, after each gate completes, call `detectNoProgress`. If the hash before and after are equal for a gate that should have produced progress, return a `V2FailureResponse{ failureKind: "no_progress_detected" }` with a diagnostic message naming the gate.
4. The guard must not fire on gates that are correctly no-ops (e.g. the pending-observation gate when there are no pending observations). Each gate must declare whether it is expected to mutate state.
5. Test: a test that feeds a state that will never progress (e.g. a pending observation that cannot be resolved by any candidate answer) and asserts the loop guard fires within one turn.

---

### REQ-E2 — V2 failure audit events wired end-to-end

**Problem:** D11 defines five audit events: `v2_failure`, `v2_failure_user_choice`, `v2_legacy_fallback_requested`, `v2_legacy_fallback_result`. It is unclear from the current code whether all five are emitted in the correct cases, and no test asserts on their emission.

**Root cause:** Audit event emission is tested for `v2_failure` in some cases but not all five, and no test mocks `logAuditEvent` and asserts the full event payload.

**Acceptance criteria:**

1. A test suite `tests/v2/failureAuditEvents.test.ts` exists (or is added to the existing failure path tests from REQ-C3).
2. The test mocks `logAuditEvent` and asserts:
   - `v2_failure` is emitted with `{ system, failureKind, auditRef }` when any V2 failure occurs.
   - `v2_failure_user_choice` is emitted when the doctor selects a chip from the failure response.
   - `v2_legacy_fallback_requested` is emitted when the doctor selects "Use legacy mode".
   - `v2_legacy_fallback_result` is emitted after the legacy flow returns a result following a requested fallback.
3. The `auditRef` field in `v2_failure` is a UUID that correlates the subsequent `v2_failure_user_choice` event.
4. No other audit event is emitted in place of these — the names are canonical and must not vary by system.

---

## F — Operational readiness

### REQ-F1 — V2 failure rate audit dashboard

**Problem:** Sprint 7 V2-601 specifies an audit dashboard for `v2_failure` and `v2_legacy_fallback_requested` events. No dashboard exists. There is no visibility into which systems are generating V2 failures in production or how often doctors are selecting legacy fallback.

**Root cause:** Sprint 7 has not started.

**Acceptance criteria:**

1. A query (or dashboard page) exists that groups `v2_failure` events by `system` and `failureKind` over a configurable time window (default: last 7 days).
2. A separate query shows `v2_legacy_fallback_requested` rate as a percentage of total confirmed assessments per system.
3. A system that exceeds a configurable threshold (default: 5% legacy fallback rate) is flagged. This flag feeds into the rollout-plan.md rollback decision gate (Stage 4 → Stage 5).
4. The dashboard is reachable by the engineering team without direct database access.
5. Both queries are covered by a test that seeds known audit events and asserts the correct aggregate values are returned.

---

### REQ-F2 — Structured_live system watchlist in CI

**Problem:** There is no automated check that prevents a `structured_live` system from regressing its calibration rate below threshold between releases. The calibration runner (REQ-B1) must be called in CI, but a mechanism to block a release when rates fall is not specified.

**Root cause:** The calibration infrastructure (REQ-B1) is a prerequisite; without it, this check cannot exist.

**Acceptance criteria:**

1. A CI step (GitHub Actions or equivalent) runs `validateStructuredLivePromotion(new FileCalibrationEvidenceReader())` against the latest calibration report.
2. Any system below its ADR-0001 threshold causes the CI step to exit non-zero with a human-readable error: `"[system] safe-outcome rate X% is below required Y%. Promote evidence or demote to structured_shadow."`
3. The CI step is non-blocking (warning) for systems on `PROVISIONAL_STRUCTURED_LIVE` whose calibration was last run more than 14 days ago (stale evidence). It is blocking (failure) for systems that have fresh evidence and are below threshold.
4. The check runs on every PR that touches `src/v2/extractors/`, `src/v2/readiness/`, `src/v2/argBuilders/`, or `src/v2/systemRegistry.ts`.

---

## Summary table

| ID | Summary | Sprint | Blocking on |
|---|---|---|---|
| REQ-A1 | CNS structured extractor | 6 | — |
| REQ-A2 | CNS readiness / arg builder / renderer | 6 | REQ-A1 |
| REQ-A3 | CNS golden tests + registry flip | 6 | REQ-A2 |
| REQ-A4 | Visual structured extractor | 6 | — |
| REQ-A5 | Visual readiness / arg builder / renderer | 6 | REQ-A4 |
| REQ-A6 | Visual golden tests + registry flip | 6 | REQ-A5 |
| REQ-B1 | Excel shadow runner / calibration infrastructure | 4 (backfill) | — |
| REQ-B2 | Spine extractor phrasing → ≥95%/90% | 3 (backfill) | REQ-B1 |
| REQ-B3 | Hearing curated goldens + calibration | 5 (backfill) | REQ-B1 |
| REQ-B4 | Full calibration for remaining 5 provisional systems | 4–5 (backfill) | REQ-B1 |
| REQ-C1 | Per-system end-to-end golden test suites | 2–5 (backfill) | — |
| REQ-C2 | No-tool-no-PI guard integration tests | 2–5 (backfill) | — |
| REQ-C3 | V2 failure path tests per system | 2–5 (backfill) | — |
| REQ-D1 | Remove slotEvaluator from structured_live path | 7 | — |
| REQ-D2 | Admin legacy route | 7 | — |
| REQ-D3 | Remove extractValues/extractSignals from live pipeline | 7 | REQ-A3, REQ-A6 |
| REQ-E1 | D17 per-turn loop guard | 7 | — |
| REQ-E2 | V2 failure audit events wired end-to-end | 2–5 (backfill) | — |
| REQ-F1 | V2 failure rate audit dashboard | 7 | REQ-E2 |
| REQ-F2 | Structured_live watchlist in CI | 7 | REQ-B1 |
