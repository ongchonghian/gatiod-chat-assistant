# Holistic PRD: GATIOD Chat Assistant V2 — Semantic Consensus, N-System Claim Orchestration, Deterministic Assessment, and Scenario-Gated Safety

**Status:** Draft v3 — expanded requirements  
**Owner:** Product / Engineering  
**Primary users:** Specialist doctors, claims reviewers, product/QA, engineering  
**Primary goal:** Make the GATIOD chat assistant understand clinical narratives as naturally as a semantic assistant, while preserving deterministic, auditable, zero-hallucination PI% calculation.

---

## 1. Executive Summary

The GATIOD chat assistant currently has two useful but incomplete modes:

| Mode | Strength | Weakness |
|---|---|---|
| Legacy API | Stronger semantic understanding through LLM reasoning and a rich prompt | Weaker state-backed audit, confirmation, no-tool-no-PI enforcement, and deterministic fact provenance |
| V2 API | Stronger deterministic safety through structured extraction, readiness validation, confirmation, arg builders, tool execution, and renderers | Weaker natural-language understanding; requires extensive custom extraction rules to recognise clinical shorthand |

The target product is a **consensus-driven deterministic assessor**:

```text
User clinical narrative
→ semantic interpretation proposal
→ doctor consensus
→ claim-level assessment plan
→ deterministic V2 extraction per component
→ readiness validation per component
→ calculation-fact confirmation per component
→ assess_* tool execution per component
→ system subtotal rendering
→ optional global CVC across all calculated positive system subtotals
→ audit trail
```

The semantic layer improves clinical-language understanding. It must not calculate PI%, build final tool arguments, write calculation-grade facts, or bypass deterministic V2 validation.

The claim orchestration layer recognises that one worker can suffer injuries across **any subset of the 9 GATIOD systems, including all 9 systems**. Multi-system assessment must therefore be treated as **N-system claim orchestration**, not pairwise handoff.

---

## 2. Product Problem

Doctors may paste dense, shorthand, multi-system findings such as:

```text
Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.
Caught in / crush machinery: Right humeral shaft fracture healed with severe angulation; Loss of left great toe - both phalanges.
Fall from height: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right sciatic nerve lesion with combined sensory and motor deficit.
Fall from height: Left shoulder active flexion limited to 90 degrees; Minimal equilibrium impairment requiring limitation only in hazardous surroundings, selected value 25%.
Caught in / crush machinery: Loss of right thumb - both phalanges; Thoraco-lumbar compression/burst fracture <25% height loss with residual pain.
Road traffic accident while working: Cervical spinal cord injury without fracture/dislocation with ASIA D motor deficit; Right humeral shaft fracture healed with severe angulation.
Scaffold collapse: Lumbo-sacral prolapsed intervertebral disc with persistent pain, restricted motion and motor deficit; Left eye best corrected visual acuity 6/18.
Confined-space toxic exposure: Renal dysfunction within the 11-30% impairment class, selected value 20%; Left corneal opacity/scar/decompensation arising from injury.
Electrical injury with fall: Left knee active flexion limited to 80 degrees; Cervical prolapsed intervertebral disc with persistent pain, restricted motion and sensory deficit.
Abdominal blunt trauma: Renal dysfunction within the 11-30% impairment class, selected value 20%; Loss of right 4th toe - three phalanges.
```

A semantic reader can identify:

| Phrase | Likely interpretation |
|---|---|
| Left common peroneal nerve lesion | Lower limb neurological impairment |
| Combined sensory and motor deficit | Lower-limb nerve deficit type |
| Complete anosmia | CNS Section B olfactory impairment |
| Traumatic olfactory nerve injury | CNS olfaction component |
| Missing detail | Partial vs total lower-limb nerve loss |

A deterministic assessor cannot safely calculate until this is converted into validated, calculation-grade facts. The app therefore needs a controlled semantic bridge: understand likely meaning, ask for doctor consensus, then proceed deterministically.

The problem is broader than two-system scenarios. A real claim can contain findings across all 9 GATIOD systems:

1. Upper limb
2. Lower limb
3. Spine
4. Respiratory
5. Renal
6. Gastro / digestive
7. Hearing
8. CNS
9. Visual

The app must not silently drop any detected system just because another system is currently being assessed.

---

## 3. Product Thesis

The future app should not be a free-form LLM calculator and should not be a brittle regex-only extractor.

It should be:

```text
LLM for interpretation proposals.
Doctor for semantic consensus.
V2 deterministic logic for calculation-grade facts.
Tools for PI%.
Renderers for traceability.
Audit logs for trust.
```

The semantic layer may propose:

- likely systems,
- likely findings,
- source spans,
- missing fields,
- unsupported or legacy-deferred components.

The semantic layer must never produce:

- final PI%,
- system subtotal PI%,
- global CVC result,
- final `assess_*` tool arguments,
- calculation-grade facts without deterministic validation.

---

## 4. Goals

| Goal | Description |
|---|---|
| Improve clinical-language understanding | Detect likely GATIOD systems and findings from natural clinical narratives. |
| Support 1–9 systems per claim | A single worker may have findings across any subset of all 9 systems. |
| Reduce generic clarification | Avoid “Which system?” when the text clearly implies systems/findings. |
| Require doctor consensus | The doctor confirms or edits the semantic interpretation before deterministic extraction proceeds. |
| Preserve deterministic calculation | Final PI% must only come from `assess_*` or `assess_global_cvc` / deterministic CVC tool evidence. |
| Prevent silent drops | Every detected component must be calculated, clarified, deferred, unsupported, or skipped by explicit user choice. |
| Improve auditability | Store semantic proposals, consensus decisions, extracted facts, confirmations, tool evidence, component traces, and global CVC snapshots separately. |
| Enable scenario-gated rollout | `structured_live` must mean scenario-proven, not merely wired. |

---

## 5. Non-Goals

| Non-goal | Explanation |
|---|---|
| LLM-calculated PI% | PI% must only come from deterministic tools or approved calculation functions. |
| LLM-authored final tool args | Tool args must still come from deterministic arg builders. |
| Replacing V2 | V2 remains the authoritative calculation pipeline. |
| Automatic inference of unstated severity | Missing calculation-critical fields must be asked, not guessed. |
| Full CNS / visual structured migration in this PRD | CNS and visual structured migration remain separate implementation projects. |
| Pairwise-only multi-system flow | The product must support 2–9 systems, not just two-system cases. |
| Silent legacy fallback | Legacy fallback must be explicit and audited. |

---

## 6. Core Product Principles

### P1 — Semantic interpretation is not extraction

A semantic proposal is a hypothesis. It is not a calculation fact.

### P2 — Consensus is not calculation confirmation

There are two distinct approvals:

| Approval | Meaning |
|---|---|
| Semantic consensus | “Yes, the app understood the clinical scenario correctly.” |
| Calculation confirmation | “Yes, these exact calculation facts are correct. Calculate.” |

### P3 — No hidden assumptions

The app may propose likely system mappings, but it must not infer calculation-critical severity unless explicitly stated or selected.

### P4 — No PI% without tool evidence

All final PI% language requires successful deterministic assessment evidence.

### P5 — No silent component drop

A detected system, region, side, eye, ear, limb, or subsystem must never be overwritten or ignored without visible handling.

### P6 — N-system claim orchestration

A worker claim may involve 1 to 9 GATIOD systems. The app must maintain independent component state for each detected system and calculate global CVC across all eligible calculated components.

### P7 — Explicit legacy/deferred handling

If a component belongs to a legacy/deferred system, the app must say so clearly and offer a supported path.

### P8 — Scenario-gated live promotion

A system is `structured_live` only if it has scenario evidence: curated goldens and Excel-derived shadow pass-rate thresholds.

---

## 7. Scope Summary

### In scope

| Area | Included |
|---|---|
| Semantic interpretation | Candidate systems, findings, source spans, missing fields, unsupported terms |
| Doctor consensus | Proceed, edit, reject, choose system first, or use legacy mode |
| Claim-level orchestration | Track 1–9 systems and their component statuses |
| Component lifecycle | detected → needs clarification → ready → confirmed → calculated → included in global CVC |
| Global CVC | Offer and calculate CVC once 2+ positive system subtotals exist |
| Legacy-aware labelling | CNS/visual and other deferred systems clearly labelled |
| Safety guards | No PI%, no final tool args, no direct fact writes from semantic layer |
| Audit events | Semantic, component, tool, global CVC, stale-state and skip/defer events |

### Out of scope

| Area | Excluded |
|---|---|
| CNS structured V2 implementation | Separate future project |
| Visual structured V2 implementation | Separate future project |
| Full Excel runner implementation | Separate implementation track, though requirements are included |
| New clinical rules not in GATIOD | Product follows GATIOD, not new medical scoring logic |

---

## 8. Current Implementation Status

This PRD is both a target-state and an implementation-status document. Current repo status should be kept updated as implementation progresses.

| Capability | Status | Notes |
|---|---|---|
| Legacy semantic reasoning | Existing | LLM prompt + tool loop provide broad semantic understanding. |
| V2 structured extraction | Existing | Implemented for several systems, maturity varies. |
| Instance state | Existing | `instancesBySystem` and `V2AssessmentInstance` exist. |
| Hearing instance readiness | Existing | Hearing is the most mature instance-aware system. |
| Global CVC soft queue | Existing / verify | Derived calculated-system helpers and stale snapshot handling exist. |
| Semantic consensus layer | Not implemented | This PRD’s primary scope. |
| Pending consensus state | Not implemented | Needs `pendingConsensus` in `V2SessionState`. |
| Structured-live promotion gate | Decision made / not fully enforced | Registry alignment and CI evidence gate pending. |
| Canonical Excel workbook | Decision made | Cross-system workbook is canonical. Fixture generator pending. |
| CNS structured V2 | Deferred | Legacy/deferred. |
| Visual structured V2 | Deferred | Legacy/deferred. |

---

## 9. Current Architectural Decisions Incorporated

| Decision | Incorporated requirement |
|---|---|
| Semantic layer is proposal-only | Semantic output cannot write facts, tool args, or PI%. |
| Dual confirmation | Semantic consensus and calculation confirmation are separate. |
| Global CVC uses derived soft queue | No persistent queue until evidence shows state loss. |
| Offer-then-combine | Global CVC requires explicit doctor action. |
| Vanilla CVC now | Cross-system caps/exclusions are follow-up unless specific GATIOD rules require them. |
| Spine multi-region guard | Known silent-overwrite patterns must safe-fail until instance migration exists. |
| CNS/visual hard-park | Semantic layer may recognise, but V2 structured calculation is deferred. |
| Excel workbook is canonical | Scenario catalogue drives promotion evidence. |
| N-system claim support | A claim may include all 9 systems; orchestration cannot assume two systems only. |

---

## 10. Claim-Level Concepts

### 10.1 Claim

A claim is the whole assessment context for one worker. It may include any subset of GATIOD systems.

### 10.2 Component

A component is one system-level assessment unit for a claim. For now, the claim-level component is usually a GATIOD system subtotal. Some systems may internally contain instances, such as ears, eyes, spine regions, or limb joints.

### 10.3 System subtotal

The final PI% for a GATIOD system after internal system rules are applied.

Examples:

| System | Subtotal meaning |
|---|---|
| Upper limb | Upper limb category combination after amputation/ROM/neuro/DBE rules |
| Spine | Spine result for supported region/category model |
| Hearing | Hearing result across injury/NID path |
| Visual | Visual subtotal, legacy/deferred until structured migration |

### 10.4 Global CVC

Global CVC combines positive system subtotals for the whole claim. It should not combine raw findings across systems. It combines system-level PI values.

Example:

```text
Hearing subtotal: 30%
Lower limb subtotal: 22%
Upper limb subtotal: 18%
Renal subtotal: 10%
Spine subtotal: 5%

Global CVC inputs: [30, 22, 18, 10, 5]
Final global PI%: calculated by CVC
```

---

## 11. Target User Experience

### 11.1 Dense all-claim interpretation

User:

```text
Polytrauma claim: right ear hearing loss AHL 90 after blast; thoraco-lumbar compression/burst fracture <25% with residual pain; left common peroneal nerve lesion with combined sensory and motor deficit; complete anosmia after olfactory nerve injury; left eye 6/60 with central diplopia; CKD stage 4; occupational asthma on high-dose inhaled steroids; recurrent hernia; left shoulder flexion 90 degrees.
```

Assistant:

```text
I think this claim contains findings across 9 GATIOD assessment areas:

1. Hearing — ready for interpretation confirmation
- Source: “right ear hearing loss AHL 90 after blast”
- Pathway: Injury/accident
- Affected ear: Right
- AHL: 90 dB

2. Spine — ready for interpretation confirmation
- Source: “thoraco-lumbar compression/burst fracture <25% with residual pain”
- Region: Thoraco-lumbar
- Finding: Compression/burst fracture <25% with residual pain

3. Lower limb — needs one clarification before calculation
- Source: “left common peroneal nerve lesion with combined sensory and motor deficit”
- Missing: whether the combined sensory/motor loss is partial or total

4. CNS — legacy/deferred
- Source: “complete anosmia after olfactory nerve injury”
- Likely component: Olfaction

5. Visual — legacy/deferred
- Source: “left eye 6/60 with central diplopia”
- Visual is currently handled by legacy assessment mode

6. Renal — ready for interpretation confirmation
- Source: “CKD stage 4”

7. Respiratory — may need pathway prerequisite confirmation
- Source: “occupational asthma on high-dose inhaled steroids”

8. Gastro / Digestive — needs subsystem confirmation
- Source: “recurrent hernia”

9. Upper limb — needs ROM direction
- Source: “left shoulder flexion 90 degrees”

How would you like to proceed?
```

Suggested actions:

```text
Proceed with ready systems | Choose system | Resolve missing details | Handle legacy systems
```

### 11.2 Simple high-confidence input

User:

```text
Right ear injury AHL 90 dB.
```

Expected behaviour:

- Semantic consensus may be skipped.
- Deterministic hearing extraction proceeds.
- Calculation confirmation is still required.

### 11.3 Multi-system ready components

User:

```text
Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.
```

Expected behaviour:

1. Semantic proposal identifies spine and hearing.
2. Doctor accepts or chooses assessment order.
3. Spine calculates 5% after calculation confirmation.
4. Hearing calculates 30% after calculation confirmation.
5. App offers global CVC.
6. Doctor selects Combine.
7. App renders combined GATIOD PI%.

---

## 12. Semantic Consensus Pipeline

The semantic consensus gate runs after pending deterministic resolution and before normal grounding/routing.

```text
1. Load V2 session state.
2. Normalize user utterance.
3. If a pending observation exists, resolve it first.
4. If pending consensus exists, resolve consensus reply first.
5. If shouldRunSemanticConsensus() returns true:
   a. generate semantic interpretation
   b. validate schema and safety constraints
   c. persist pendingConsensus
   d. render semantic proposal
   e. stop
6. Otherwise continue:
   a. retrieve grounding
   b. route utterance
   c. run deterministic extraction
   d. validate readiness
   e. confirm calculation facts
   f. execute tools
   g. render results
7. If 2+ positive system subtotals exist and no pending next-system work blocks it, offer global CVC.
```

### Ordering invariant

Short replies must resolve state first:

| Pending state | User reply | Must happen before routing |
|---|---|---|
| pending observation | `Flexion`, `Partial`, `Left` | Resolve missing field |
| pending consensus | `Proceed`, `Edit`, `Assess hearing first` | Resolve consensus |
| pending confirmation | `Confirm` | Resolve calculation confirmation |
| pending global CVC | `Combine` | Resolve global CVC confirmation |

---

## 13. Functional Requirements — Semantic Consensus

### FR-SC-001 — Semantic trigger policy

The app shall run semantic consensus when the utterance is likely to benefit from interpretation before deterministic extraction.

Trigger conditions:

| Trigger | Example |
|---|---|
| Multiple systems likely | lower limb nerve + CNS anosmia |
| 2–9 systems present | polytrauma claim across multiple chapters |
| CNS or visual detected | olfactory nerve, diplopia |
| Multiple semicolon-separated findings | fracture; hearing loss; renal failure |
| Ambiguous routing | gait, paralysis, herniation |
| Multiple regions/sides/organs | cervical + lumbar; left + right eye |
| Dense narrative | mechanism + several injuries |
| Deterministic route confidence low/conflicting | competing systems |

Skip conditions:

| Condition | Example |
|---|---|
| Simple high-confidence single-system input | right ear injury AHL 90 |
| User is answering pending question | `Partial` |
| User is confirming calculation | `Confirm` |
| User is confirming global CVC | `Combine` |

Acceptance criteria:

- Multi-system clinical narrative triggers semantic proposal.
- Simple single-system deterministic case may skip semantic proposal.
- Pending observation replies never trigger semantic proposal.

---

### FR-SC-002 — Semantic interpretation schema

The semantic interpreter shall return schema-validated JSON.

```ts
interface SemanticInterpretation {
  id: string;
  sourceText: string;
  sourceHash: string;
  candidateSystems: SemanticCandidateSystem[];
  candidateFindings: SemanticCandidateFinding[];
  unsupportedTerms: string[];
  assumptions: string[];
  requiresUserConsensus: true;
  createdAt: string;
}
```

```ts
interface SemanticCandidateSystem {
  system: GatiodSystemKey;
  confidence: number;
  status: "structured_supported" | "structured_shadow" | "legacy_deferred";
  evidence: string[];
  rationale: string;
}
```

```ts
interface SemanticCandidateFinding {
  system: GatiodSystemKey;
  sourceSpan: string;
  findingType:
    | "amputation"
    | "rom"
    | "neurological"
    | "dbe"
    | "spine_diagnosis"
    | "hearing_loss"
    | "respiratory_function"
    | "renal_function"
    | "gastro_subsystem"
    | "cns_component"
    | "visual_component"
    | "other";
  proposedMapping: string;
  systemConfidence: number;
  mappingConfidence: number;
  completeness: "complete_for_extraction" | "missing_calculation_fields" | "unsupported";
  explicitlyStatedFields: string[];
  inferredFields: string[];
  missingFields: string[];
  calculationReady: false;
}
```

Acceptance criteria:

- Every candidate finding has a source span.
- `calculationReady` is always false.
- Candidate system must be one of the 9 GATIOD systems.
- Legacy/deferred systems are labelled.

---

### FR-SC-003 — Semantic validation blocking errors

The app shall reject semantic model output if it violates safety boundaries.

Blocking errors:

| Error | Behaviour |
|---|---|
| Contains PI% or `piPercent` | Reject semantic output |
| Contains `toolName`, `args`, or `assess_*` plan | Reject semantic output |
| `calculationReady: true` | Reject semantic output |
| Missing source span | Reject semantic output |
| Unknown system | Reject semantic output |
| Legacy/deferred system not labelled | Reject semantic output |

Fallback message:

```text
I could not confidently interpret all findings. Please identify the GATIOD system or provide one finding at a time.
```

---

### FR-SC-004 — Pending consensus state

The app shall persist pending semantic consensus separately from extracted facts.

```ts
interface PendingConsensus {
  interpretationId: string;
  interpretationHash: string;
  sourceHash: string;
  sourceText: string;
  message: string;
  candidateSystems: GatiodSystemKey[];
  createdAt: string;
}
```

`V2SessionState` shall include:

```ts
pendingConsensus: PendingConsensus | null;
```

Acceptance criteria:

- `Proceed` resolves pending consensus, not normal routing.
- `Edit interpretation` keeps deterministic extraction blocked.
- `Reject` clears pending consensus and does not write facts.

---

### FR-SC-005 — Semantic proposals cannot mutate calculation facts

Semantic interpretation shall not write to:

```text
systemState.extractedFacts
instance.facts
pendingConfirmation
piPercent
tool args
```

Only deterministic extractors may write calculation-grade facts.

---

### FR-SC-006 — Semantic-to-deterministic context

After doctor consensus, accepted semantic interpretation may be passed as context to deterministic extractors.

```ts
interface ExtractionContext {
  acceptedInterpretationId?: string;
  acceptedCandidateSystems: GatiodSystemKey[];
  acceptedFindings: SemanticCandidateFinding[];
}
```

Deterministic extractors still decide whether facts are calculation-grade.

---

### FR-SC-007 — Semantic/deterministic disagreement handling

If semantic consensus is accepted but deterministic extraction cannot map the accepted finding, the app shall fail visibly and ask targeted clarification.

Example:

```text
I understood this as a lower-limb common peroneal nerve finding, but I could not convert it into a calculation-ready V2 fact. Please confirm the nerve and whether loss is partial or total.
```

Audit event:

```text
semantic_to_structured_extraction_failed
```

---

## 14. Functional Requirements — Claim-Level N-System Orchestration

### FR-MS-001 — Support 1–9 systems per claim

The app shall support a single claim containing findings across any subset of the 9 GATIOD systems, including all 9.

Acceptance criteria:

- Semantic proposal can list 1–9 candidate systems.
- The app does not cap detected systems at two.
- The app presents a claim-level assessment plan when more than two systems are detected.

---

### FR-MS-002 — Claim assessment component model

The app shall maintain component state for each detected system.

```ts
interface ClaimAssessmentComponent {
  system: GatiodSystemKey;
  status:
    | "detected"
    | "needs_clarification"
    | "ready_for_confirmation"
    | "confirmation_pending"
    | "confirmed"
    | "calculated"
    | "legacy_deferred"
    | "unsupported"
    | "skipped_by_user";
  piPercent?: number;
  instanceIds?: string[];
  missingFields?: string[];
  lastUpdatedAt: string;
}
```

Acceptance criteria:

- Every detected system has one component record.
- A component cannot disappear from the claim plan without being calculated, deferred, unsupported, or skipped.

---

### FR-MS-003 — Assessment plan rendering

For 3+ detected systems, the app shall render an assessment plan rather than a long flat confirmation card.

Plan sections:

| Section | Meaning |
|---|---|
| Ready for confirmation | Deterministic facts are complete |
| Needs clarification | Missing calculation-critical fields |
| Legacy/deferred | System detected but not structured-live |
| Unsupported/safe-fail | Detected but cannot be handled safely |
| Calculated | System subtotal already calculated |

Example actions:

```text
Start with ready systems | Choose system | Resolve missing details | Handle legacy systems | Skip selected system
```

---

### FR-MS-004 — Doctor-controlled assessment order

The doctor may choose assessment order. The app may suggest an order.

Default suggested order:

1. Components ready for confirmation
2. Components with minimal missing fields
3. Legacy/deferred systems
4. Unsupported/safe-fail components

The app shall not assume that semantic list order is the calculation order.

---

### FR-MS-005 — No silent skip

If the doctor chooses to skip a detected system, the app shall store:

```ts
status: "skipped_by_user"
```

and audit:

```text
v2_component_skipped_by_user
```

The skipped system must not be included in global CVC.

---

### FR-MS-006 — Multiple systems in one utterance

When the router or semantic layer detects multiple systems in one utterance, the app shall attempt extraction for each supported system and persist each system’s state independently.

Acceptance criteria:

- Spine + hearing does not lose spine while hearing is assessed.
- Lower limb + CNS marks CNS as legacy/deferred while continuing lower limb.
- A 9-system narrative produces 9 component entries.

---

### FR-MS-007 — Intra-system instance safety

For systems with internal instances, facts must not overwrite each other.

Examples:

| System | Instance risk | Required behaviour |
|---|---|---|
| Hearing | right AHL applied to left ear | Ear-specific instance |
| Spine | cervical overwritten by lumbar | Guard or region instances |
| Upper limb | left shoulder mixed with right shoulder | Side/joint instance |
| Lower limb | toe amputation mixed with shortening | Category/side instance |
| Visual | diplopia mixed with one eye | Eye/diplopia instances |
| Gastro | hernia mixed with liver/biliary | Subsystem instance |

---

## 15. Functional Requirements — Deterministic Extraction, Readiness, and Confirmation

### FR-DET-001 — Deterministic facts only after extraction

Only deterministic extractors may write `extractedFacts` or instance facts.

### FR-DET-002 — Readiness required before calculation confirmation

No calculation confirmation card may be rendered unless readiness passes.

Fail-closed behaviour:

```text
I cannot present a confirmation yet — required fields are missing: {fields}. Please provide the missing details.
```

### FR-DET-003 — Calculation confirmation required before `assess_*`

A successful semantic consensus is not sufficient to calculate. Calculation confirmation remains mandatory.

### FR-DET-004 — Facts hash / snapshot guard

If facts change after calculation confirmation is presented, confirmation becomes stale.

### FR-DET-005 — Arg builder validation

Every arg builder must validate final args against the relevant schema. If validation fails, no calculation occurs.

### FR-DET-006 — Zero-value defaults must be explicit

Arg builders may zero-fill absent streams only when the absence is clinically valid and traceable. Required clinical facts must never be defaulted.

---

## 16. Functional Requirements — Global CVC Across 2–9 Systems

### FR-GC-001 — Offer global CVC after 2+ positive system subtotals

Once two or more systems have positive calculated PI%, the app shall offer global CVC.

It shall not auto-combine without doctor action.

Offer copy:

```text
Completed system assessments:
- Hearing: 30%
- Spine: 5%

Calculate combined GATIOD PI% using the Combined Values Chart?
```

Actions:

```text
Combine | Add another system | Edit a finding
```

---

### FR-GC-002 — Support 2–9 CVC inputs

Global CVC shall combine all positive calculated system subtotals, from 2 up to 9 systems.

Examples:

| Calculated systems | CVC inputs |
|---|---|
| Spine + hearing | [30, 5] |
| Spine + hearing + renal | [30, 10, 5] |
| All 9 systems | positive subtotals from all 9 systems, sorted descending |

---

### FR-GC-003 — Exclude zero-value systems from CVC but keep audit trace

A system with 0% PI shall not be included in the global CVC inputs, but it must appear in the component trace.

Trace example:

```text
Respiratory: 0% — excluded from global CVC
Hearing: 30% — included
Spine: 5% — included
```

---

### FR-GC-004 — Global CVC snapshot

When the app offers global CVC, it shall store a snapshot:

```ts
interface PendingGlobalCvcConfirmation {
  status: "pending";
  componentSystems: GatiodSystemKey[];
  componentValues: number[];
  createdAt: string;
}
```

---

### FR-GC-005 — Stale global CVC detection

A pending or completed global CVC result becomes stale if:

| Change | Behaviour |
|---|---|
| Any component PI changes | Re-offer global CVC |
| A component is edited and PI cleared | Re-offer after recalculation |
| A new positive system subtotal is added | Previous global CVC stale; re-offer across all positive systems |
| A component is skipped | Re-offer if it was previously included |

---

### FR-GC-006 — Global CVC result rendering

Global result must show:

- all included system subtotals,
- excluded zero-value systems,
- input order,
- CVC calculation trace,
- final global PI%,
- tool evidence / deterministic calculation evidence.

Example:

```text
Combined GATIOD PI%: 34%

CVC inputs:
- Hearing: 30%
- Spine: 5%

Calculation:
30% combined with 5% → 34%

System-generated GATIOD PI%: 34%
```

---

### FR-GC-007 — Global CVC audit events

Required events:

```text
v2_global_cvc_offered
v2_global_cvc_confirmed
v2_global_cvc_executed
v2_global_cvc_stale
v2_global_cvc_declined
```

---

## 17. Functional Requirements — Legacy and Deferred Systems

### FR-LG-001 — CNS / visual hard-park

CNS and visual remain legacy/deferred until structured models exist.

Semantic proposals may recognise CNS/visual but must label them:

```text
CNS is currently handled by legacy assessment mode.
```

---

### FR-LG-002 — Legacy component still counts as detected

A legacy-deferred component must appear in the claim plan with status:

```text
legacy_deferred
```

It must not be silently ignored.

---

### FR-LG-003 — Explicit legacy action

The doctor may choose:

```text
Use legacy mode for CNS
```

This action must be audited.

No silent fallback.

---

### FR-LG-004 — Legacy-deferred cross-system rows

In Excel shadow tests, a row containing supported + legacy systems shall grade supported components normally and mark legacy components as routing-only or legacy-deferred.

---

## 18. Safety Requirements

| ID | Requirement |
|---|---|
| SR-001 | Semantic layer must never calculate or estimate PI%. |
| SR-002 | Semantic layer must never call `assess_*`. |
| SR-003 | Semantic layer must never directly write calculation-grade facts. |
| SR-004 | Doctor consensus required for inferred semantic mappings. |
| SR-005 | Deterministic readiness validators remain mandatory. |
| SR-006 | Calculation confirmation remains mandatory. |
| SR-007 | All arg builders must validate before tool execution. |
| SR-008 | No final PI% without successful tool or deterministic CVC evidence. |
| SR-009 | No detected component may be silently dropped. |
| SR-010 | Legacy fallback requires explicit user choice. |
| SR-011 | Global CVC must become stale when any included component changes. |
| SR-012 | A worker claim may contain all 9 systems; the app must not truncate systems due to UI or state limits. |

---

## 19. Audit Requirements

### Semantic audit events

```text
semantic_interpretation_created
semantic_interpretation_schema_failed
semantic_interpretation_accepted
semantic_interpretation_rejected
semantic_interpretation_edited
semantic_legacy_deferred_component
semantic_to_structured_extraction_started
semantic_to_structured_extraction_failed
```

### Component audit events

```text
v2_component_detected
v2_component_needs_clarification
v2_component_ready_for_confirmation
v2_component_calculated
v2_component_legacy_deferred
v2_component_unsupported
v2_component_skipped_by_user
v2_component_state_stale
```

### Global CVC audit events

```text
v2_global_cvc_offered
v2_global_cvc_confirmed
v2_global_cvc_executed
v2_global_cvc_stale
v2_global_cvc_declined
```

### Minimum payload

```ts
interface ClaimAuditPayload {
  sessionId: string;
  claimId?: string;
  userId?: string;
  sourceHash?: string;
  systemsDetected?: GatiodSystemKey[];
  components?: Array<{
    system: GatiodSystemKey;
    status: string;
    piPercent?: number;
  }>;
  globalCvcInputs?: Array<{
    system: GatiodSystemKey;
    piPercent: number;
  }>;
}
```

---

## 20. UX Requirements

### UX-001 — Claim assessment plan for 3+ systems

When 3 or more systems are detected, the app shall show an assessment plan, not a long confirmation card.

### UX-002 — Source spans visible

Every semantic finding must show the source phrase.

### UX-003 — Clear status labels

Use consistent labels:

```text
Ready
Needs clarification
Legacy/deferred
Unsupported
Calculated
Skipped
```

### UX-004 — Compact but traceable result

Component result default:

```text
System-generated GATIOD PI%: 30%

Hearing — Injury/Accident:
- Right ear: 30%

Final Hearing PI%: 30%
```

Full breakdown available or inline when exceptions apply.

### UX-005 — Global CVC result distinct from system results

Global result must be clearly labelled as combined claim-level PI%, not a system subtotal.

---

## 21. System-Specific Semantic Requirements

### Upper limb

Recognise:

- side,
- joint/part,
- ROM values and directions,
- ambiguous bare angles,
- amputation levels,
- nerve findings,
- DBE terms.

Must ask, not infer, when ROM direction is missing.

### Lower limb

Recognise:

- side,
- common peroneal, femoral, sciatic and other lower-limb nerves,
- sensory/motor/combined deficit,
- partial vs total missing field,
- toe vs shortening distinction,
- DBE and ROM findings.

### Spine

Recognise:

- cervical,
- thoraco-lumbar,
- lumbo-sacral,
- fracture/dislocation,
- disc categories,
- compression/burst <25% / >25%,
- multi-region unsupported until instance migration.

### Respiratory

Recognise:

- FVC,
- FEV1,
- DLCO,
- VO2 max,
- occupational asthma,
- medication class,
- asbestosis/silicosis terms.

### Renal

Recognise:

- CKD stage,
- creatinine clearance,
- serum creatinine,
- dialysis,
- solitary kidney,
- eGFR as ambiguous unless mapped/confirmed.

### Gastro / digestive

Recognise:

- upper digestive,
- colonic/rectal/anal,
- liver/biliary,
- herniation,
- bracket/PI% selection need.

### Hearing

Recognise:

- NID vs injury/accident path,
- affected ear,
- AHL,
- tinnitus as gate/associated finding,
- unilateral vs bilateral injury.

### CNS

Recognise semantically but mark legacy/deferred:

- olfaction / anosmia,
- facial nerve,
- equilibrium,
- swallowing,
- station/gait,
- respiration,
- cerebral groups,
- paralysis mappings.

### Visual

Recognise semantically but mark legacy/deferred:

- left/right eye,
- acuity,
- visual field,
- diplopia,
- legal blindness,
- glaucoma and other modifiers.

---

## 22. Golden Scenarios

### GS-001 — Lower limb + CNS

Input:

```text
Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.
```

Expected:

- Semantic proposal identifies lower limb and CNS.
- Lower limb finding shows source span.
- Missing field: partial vs total loss.
- CNS is legacy/deferred.
- No PI%.
- No tool call.

### GS-002 — Spine + hearing + global CVC

Input:

```text
Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.
```

Expected:

- Spine extracted as thoraco-lumbar compression/burst <25%.
- Hearing extracted as right-ear injury AHL 90.
- Spine subtotal 5%.
- Hearing subtotal 30%.
- Global CVC offered.
- Global CVC result after doctor chooses Combine.

### GS-003 — Ambiguous upper-limb ROM

Input:

```text
Left shoulder 90 degrees.
```

Expected:

- Upper limb detected.
- Side and joint detected.
- Angle detected.
- Movement direction missing.
- Ask direction.
- No inferred flexion.

### GS-004 — Multi-region spine safe-fail

Input:

```text
Cervical fracture and lumbo-sacral disc prolapse.
```

Expected:

- Multiple spine regions detected.
- No overwrite.
- Safe-fail or ask to assess one region at a time.

### GS-005 — All-9-system interpretation

Input:

```text
Polytrauma with upper limb, lower limb, spine, respiratory, renal, gastro, hearing, CNS, and visual findings.
```

Expected:

- Semantic proposal can represent all 9 systems.
- Assessment plan groups by status.
- No system silently omitted.
- Legacy/deferred systems marked.
- No PI% from semantic layer.

---

## 23. Testing Strategy

### Unit tests

| Module | Required tests |
|---|---|
| Semantic schema | Valid/invalid JSON, prohibited fields, missing spans |
| Trigger policy | Complex vs simple inputs |
| Consensus resolver | Proceed/edit/reject/choose system |
| Claim component model | 1–9 systems, status transitions |
| Global CVC | 2–9 inputs, stale detection, zero exclusion |
| No-PI guard | Semantic response with final PI language blocked |

### Integration tests

| Test | Expected |
|---|---|
| Lower limb + CNS | Proposal, missing partial/total, CNS deferred |
| Spine + hearing | Component calculations and global CVC offer |
| All-9-system narrative | 9 components in assessment plan |
| Add new system after global CVC | Previous global CVC stale |
| Edit included system after global CVC | Previous global CVC stale |

### Excel scenario tests

Excel runner should classify outcomes as:

```text
exact_calculation
clarification_required
unsupported_safe_fail
routing_only
legacy_deferred
```

Metrics should be component-level and claim-level.

---

## 24. Metrics

| Metric | Target |
|---|---:|
| P0 semantic golden pass rate | 100% |
| Semantic source-span coverage | 100% |
| Semantic schema validation success | ≥95% shadow before UI rollout |
| Multi-system recall on curated set | ≥95% |
| All detected components represented in plan | 100% |
| Generic “which system?” fallback rate | Reduce by 50% |
| No-tool PI violations | 0 |
| Silent component drops | 0 |
| Global CVC stale-state misses | 0 |
| Legacy-deferred labelling | 100% |
| Accepted consensus → deterministic extraction success | ≥90% for supported systems |

---

## 25. Rollout Plan

The implementation is sequenced as eight slices A→H. The critical dependency is that the consensus resolver (D) and unified claim plan (B) must exist before the semantic interpreter is user-visible (F) — otherwise the app could create `pendingConsensus` it cannot resolve, or accept systems that disappear from the claim plan.

### Slice A — Contracts and hydration (zero behaviour change)

- Add types: `PendingConsensus`, `ClaimComponentOverride`, `GlobalCvcExclusion`, `ExtractionContext`, `SemanticInterpretation`, `SemanticCandidateSystem`, `SemanticCandidateFinding`, `ConsensusResolutionResult`.
- Extend `V2SessionState` with `pendingConsensus`, `claimComponentOverrides`, `globalCvcExclusions`.
- Update `defaultV2SessionState()` and `coerceV2State()` so old sessions hydrate to safe defaults. No DB migration. No `version` bump.
- Update `StructuredExtractor` type with optional 4th `extractionContext` parameter.
- Update `getCalculatedSystems()` to filter `globalCvcExclusions`.
- All existing tests pass; no user-visible behaviour change.

### Slice B — Unified claim plan foundation

- Implement `deriveClaimAssessmentComponents()` reading `V2SystemState` + `instancesBySystem` + `claimComponentOverrides` + pending states.
- Implement `buildNextClaimStep()` returning typed `ClaimStep`.
- Wrap `buildNextSystemHandoff()` first; replace once tests pass.
- Existing 2-system handoff UX unchanged; 3+ system claim plans now possible; legacy/deferred overrides visible.

### Slice C — Semantic gate (feature-flagged off)

- Implement `shouldRunSemanticConsensus()` as a deterministic preflight (no LLM).
- Wire the gate into `chatServiceV2.ts` after the pending-observation gate, before grounding/routing.
- Initially feature-flagged off (`SEMANTIC_CONSENSUS_ENABLED=false`) so insertion order and skip conditions can be tested in isolation.

### Slice D — Deterministic consensus resolver (with mocked fixtures)

- Implement `tryResolvePendingConsensus()` covering all six branches: `accepted_all`, `accepted_system_first`, `edit_requested`, `rejected`, `legacy_requested`, `skipped_system`.
- Reuse `detectExplicitSystemSelection` constrained to `pendingConsensus.candidateSystems`.
- Use mocked `pendingConsensus` fixtures in tests; no real LLM yet.

### Slice E — Semantic interpreter in shadow mode

- Add `semanticSystemTaxonomy.ts` (registry-backed clinical signal taxonomy).
- Add `semanticInterpreterPrompt.ts` (safety rules + generated taxonomy section).
- Add `SemanticInterpretationSchema` (Zod), `validateSemanticInterpretation` (safety + source-span verification), `renderSemanticConsensus`.
- Implement `semanticInterpreter()` using schema-constrained structured output where the model provider supports it; fallback to instructed JSON only if not.
- Run behind opt-in flag; compare against router as audit-only.

### Slice F — User-visible semantic consensus

- Enable `shouldRunSemanticConsensus()` for qualifying triggers: multi-system narratives, legacy/deferred systems, multi-region spine, ambiguous routing, dense semicolon-separated findings.
- On trigger: validate, persist `pendingConsensus`, render proposal, stop pipeline.
- Extraction runs against `pendingConsensus.sourceText`, never against the acceptance reply.

### Slice G — Extraction context and selected-scope support

- Update spine extractor to honour `extractionContext.selectedScope` for multi-region narrowing.
- Update other extractors to accept (but optionally ignore) `extractionContext`.
- Validate that semantic findings never become `extractedFacts` directly.

### Slice H — Semantic-attributed pending observations

- Extend `PendingObservation` with optional `semanticAttribution` (`interpretationId`, `sourceSpan`, `proposedMapping`, `findingType`, `confidence`, `failureKind`).
- Add new type `"semantic_mapping_gap"`.
- Emit `semantic_to_structured_extraction_failed` audit event when consensus is accepted but extractor cannot produce calculation-grade facts.

### Phase X — Excel semantic reporting (post-rollout)

- Add semantic outcome classes (`semantic_proposal_correct | partial | unsafe | failed`).
- Track recall, fallback, semantic correction rate against a curated golden set, then against Excel-derived scenarios.

---

## 26. Implementation Backlog

### P0 — must ship together for safe rollout

Each P0 item maps to one or more of the slices in §25.

| # | Item | Slice | Description |
|---:|---|---|---|
| 1 | Semantic and claim contracts | A | `PendingConsensus`, `ClaimComponentOverride`, `GlobalCvcExclusion`, `ExtractionContext`, `SemanticInterpretation` family, `ConsensusResolutionResult` |
| 2 | State hydration extension | A | Extend `defaultV2SessionState` and `coerceV2State` for new additive fields (no DB migration, no version bump) |
| 3 | `StructuredExtractor` 4th param | A | Make `extractionContext` an optional fourth parameter on the registry type |
| 4 | `getCalculatedSystems()` exclusion | A | Filter `globalCvcExclusions` so excluded systems do not enter Global CVC |
| 5 | Unified claim plan derivation | B | `deriveClaimAssessmentComponents` reading state + overrides |
| 6 | `buildNextClaimStep` + render modes | B | Replaces `buildNextSystemHandoff` as orchestration entry point |
| 7 | Deterministic consensus gate | C | `shouldRunSemanticConsensus()`, feature-flagged off initially |
| 8 | Deterministic consensus resolver | D | Six branches; reusable `detectExplicitSystemSelection` constrained to candidate systems |
| 9 | Registry-backed semantic taxonomy | E | `semanticSystemTaxonomy.ts` keyed by `GatiodSystemKey`, status derived from `V2_SYSTEM_REGISTRY` |
| 10 | Schema-constrained semantic interpreter | E | Structured output (Option A-prime); Zod validation; safety validator with source-span verification |
| 11 | Semantic consensus renderer | E | Doctor-facing proposal card with source spans, missing fields, legacy/deferred labels |
| 12 | Multi-region spine selected-scope | G | `ExtractionContext.selectedScope` so "Cervical first" does not re-trigger the full-text guard |
| 13 | Semantic-attributed pending observations | H | `semanticAttribution` field on `PendingObservation`; `semantic_to_structured_extraction_failed` audit event |
| 14 | Fast semantic golden tests | E/F | Schema, safety validator, renderer, state transitions — no real LLM |

### P1 — required for production trust

| Item | Description |
|---|---|
| Semantic shadow runner (opt-in) | Run real interpreter offline; grade against curated and Excel scenarios; `GATIOD_RUN_SEMANTIC_SHADOW=true` |
| Global CVC re-offer on exclusion change | Stale `pendingGlobalCvcConfirmation` when a calculated system is excluded or re-included; new audit events `v2_global_cvc_component_excluded` / `v2_global_cvc_component_reincluded` |
| Edit-cycle re-interpretation | When `pendingConsensus.awaiting === "edit_instruction"`, re-run semantic interpreter with original + previous + correction |
| Registry alignment | Ensure semantic taxonomy `semanticStatus` derives from `V2_SYSTEM_REGISTRY` mode without prompt drift |
| Audit dashboard for semantic events | `semantic_interpretation_*`, `v2_component_*`, `v2_global_cvc_*` events surfaced in the audit log UI |

### P2 — follow-ups

| Item | Description |
|---|---|
| Excel fixture generator for semantic scenarios | Add semantic outcome classification to the scenario fixture |
| Structured edit UI | Let doctor edit interpretation with structured chip controls instead of free-text edit instructions |
| Metrics dashboard | Track recall, fallback rate, semantic correction rate, component drop rate |
| CNS/visual structured migration ADR | Plan for graduating CNS and visual out of `legacy_deferred` |
| Full Excel semantic threshold enforcement | Move semantic shadow from observational to gating, mirroring ADR-0001 |

---

## 27. Open Questions

| Question | Initial recommendation |
|---|---|
| Should semantic consensus show for every long message? | No; only trigger when it reduces risk or confusion. |
| Should global CVC auto-run after 2 systems? | No; offer-then-combine. |
| How many systems can a claim plan show? | Up to all 9 systems. |
| Should zero-value systems appear in global result trace? | Yes, as excluded. |
| Should legacy-deferred systems block global CVC? | No, if doctor explicitly chooses to proceed without them; audit as deferred/skipped. |
| Should a previous global CVC remain valid after a new system is added? | No; mark stale and recompute. |
| Should all 9 systems eventually become structured_live? | Yes, but only after ADR-0001 scenario evidence. |

---

## 28. Architectural Decisions (Grilling Session, 2026-05-10)

The following decisions were made during a structured design review. They refine and extend the requirements above. Where a decision conflicts with earlier prose, the decision wins.

### REQ-SC-PRECEDENCE-001 — Router/semantic interpreter precedence

For inputs that trigger semantic consensus, the semantic interpreter replaces the router as the user-facing routing decision. The router may still run in shadow mode for comparison, audit, and metrics, but its output must not drive extraction or user prompts until the doctor accepts or rejects the semantic interpretation. After acceptance, deterministic extraction targets are derived from the accepted candidate systems; the router may validate as a secondary signal but must not silently add or remove systems.

### REQ-SC-GATE-001 — Deterministic semantic consensus gate

The app shall decide whether to invoke the semantic interpreter using a deterministic preflight classifier. The gate must not call an LLM. It may use normalized utterance data, session state, punctuation/structure signals, local system synonym matches, legacy/deferred system indicators, and scope-conflict rules. The gate must return auditable trigger reasons.

### REQ-SC-OUTPUT-001 — Schema-constrained semantic output

The semantic interpreter shall use schema-constrained structured JSON output where supported by the model provider (Option A-prime). This output must not expose or execute `assess_*` tools. The model is only allowed to return a `SemanticInterpretation` object. The app shall then run Zod schema validation and semantic safety validation before rendering any proposal. If schema-constrained output is unavailable, the fallback is instructed JSON in the system prompt followed by the same validators. Prose-then-parse is not permitted in production.

### REQ-SC-PROMPT-001 — Registry-backed semantic taxonomy

The semantic interpreter prompt shall be assembled from a static safety instruction block plus a generated GATIOD system taxonomy section. System availability/status must be derived from `V2_SYSTEM_REGISTRY` or a registry-backed taxonomy module (`semanticSystemTaxonomy.ts`), not hardcoded independently in prompt prose. The semantic prompt may describe system recognition signals and missing-field hints but must not include PI tables, CVC formulas, final percentages, or `assess_*` tool argument schemas.

### REQ-SC-STATE-001 — Additive state hydration

Adding `pendingConsensus`, `claimComponentOverrides`, and `globalCvcExclusions` to `V2SessionState` is strictly additive. They shall be hydrated by extending `defaultV2SessionState()` and `coerceV2State()`. No DB migration. No `version` bump. A version bump is reserved for breaking changes (rename, semantic change, structural move).

### REQ-MS-COMPONENT-001 — Derived `ClaimAssessmentComponent`

`ClaimAssessmentComponent` is a derived view model, not a fully stored parallel state object. The only persisted claim-level component state is `claimComponentOverrides`, used for statuses that cannot be derived from `V2SystemState` (`detected`, `legacy_deferred`, `unsupported`, `skipped_by_user`). `V2SystemState` remains the source of truth for deterministic extraction, readiness, confirmation, calculation, and PI%.

### REQ-MS-EXTRACT-001 — Extraction context passing

Accepted semantic interpretation is passed to deterministic extractors through a fourth optional `ExtractionContext` parameter on `StructuredExtractor`. The context is explicit, ephemeral, and read-only. It must not be stored inside `V2SystemState` and must not be encoded into `NormalizedUtterance`. When a doctor accepts a semantic proposal, extraction runs against the original source text stored in `pendingConsensus`, not against the short acceptance reply such as "Proceed".

### REQ-SC-RESOLVE-001 — Deterministic consensus resolver

When `pendingConsensus` is present, the app shall resolve the doctor's reply using deterministic chip, keyword, and system-selection parsing. The resolver must not call an LLM merely to classify consensus intent. Priority order: `rejected` > `legacy_requested` > `skipped_system` > `accepted_system_first` > `edit_requested` > `accepted_all` > `unresolved`. If the reply is ambiguous, the app shall re-render the consensus choices and stop the pipeline.

### REQ-SC-RESOLVE-002 — Edit instructions invoke semantic re-interpretation

If the doctor provides a free-text correction, the resolver classifies the turn as `edit_requested` deterministically, then invokes the semantic interpreter with the original source text, previous interpretation, and doctor correction to produce a revised proposal. `PendingConsensus.awaiting` shall track `"decision" | "edit_instruction"`.

### REQ-MS-PLAN-001 — Unified claim plan

Assessment handoff is not a separate workflow. It is a compact rendering mode of the unified claim assessment plan. The app shall derive claim-level components from V2 system state plus claim component overrides. After every major transition — consensus accepted, clarification resolved, system calculated, user skips/defer — the app shall derive the next claim step from the unified claim plan. No detected, accepted, deferred, unsupported, or skipped system may disappear from the claim plan merely because it has no extracted facts.

### REQ-GC-EXCLUSION-001 — Distinguish skip from CVC exclusion

`skipped_by_user` means a system was never assessed. `excluded_from_global_cvc` means a system was assessed (with a valid PI%) but explicitly omitted from the combined PI% by doctor choice. Use `claimComponentOverrides` for the former and a separate `globalCvcExclusions` map for the latter. `getCalculatedSystems()` must filter by `globalCvcExclusions`. Excluding or re-including a calculated system stales any pending Global CVC offer.

### REQ-SC-DISAGREE-001 — Semantic-to-structured disagreements use `PendingObservation`

Semantic-to-structured extraction disagreements shall normally be represented as `PendingObservation` records with `semanticAttribution` and type `"semantic_mapping_gap"`. The audit event `semantic_to_structured_extraction_failed` fires regardless. A separate failure state is used only when the gap cannot be resolved by user clarification or when the semantic output violates safety/schema constraints.

### REQ-SC-SPINE-001 — Semantic multi-region spine warning

If semantic interpretation detects spine findings in more than one spinal region, the proposal shall identify each region with source spans and warn that structured V2 supports one spine region at a time. The doctor must select a region to assess first before deterministic extraction proceeds for spine.

### REQ-SC-SPINE-002 — Deterministic spine guard remains authoritative

The spine extractor's multi-region guard remains mandatory. Semantic narrowing may pass `extractionContext.selectedScope.sourceSpans` into the extractor, but if the extractor still detects multiple regions, it must block and emit `spine_multi_region_unsupported`.

### REQ-SC-TEST-001 — Two-tier semantic testing

Fast semantic golden tests shall run in default CI and validate schema, safety rules, rendering, and state transitions without a real LLM. Slow semantic shadow tests shall run only when explicitly enabled (`GATIOD_RUN_SEMANTIC_SHADOW=true`) and shall evaluate real semantic interpreter quality using curated and Excel-derived scenarios. Semantic proposal tests do not assert final PI%; they assert correct candidate systems, source spans, missing fields, legacy/deferred labelling, and absence of prohibited calculation/tool output.

---

## 29. Final Recommendation

Adopt this PRD as the target architecture for the GATIOD Chat Assistant V2.

The product should be:

```text
Semantic layer understands.
Doctor confirms interpretation.
Claim plan tracks all detected systems.
V2 structures facts.
Tools calculate system subtotals.
Global CVC combines all eligible positive subtotals.
Renderer explains.
Audit proves.
```

Most importantly:

```text
A worker can suffer injuries across all 9 GATIOD systems.
The app must treat that as a first-class claim orchestration problem, not a special case.
```
