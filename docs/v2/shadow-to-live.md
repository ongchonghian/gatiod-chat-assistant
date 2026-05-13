# Shadow Mode: Purpose, Process, and Promotion Gates

This document explains what `structured_shadow` mode does, why it exists, and
every piece of work required before a system can be promoted to `structured_live`.

Read [rollout-plan.md](rollout-plan.md) for the five-stage rollout overview.
Read [architecture-decisions.md](architecture-decisions.md) D5 for the shadow
anti-pattern (split-brain) that this process is designed to prevent.

---

## Implementation audit snapshot — 2026-05-11

| Area | Status | Notes |
|---|---|---|
| Component files (36 total, 9×4) | ✓ ALL PRESENT | All extractors, validators, argBuilders, renderers non-empty |
| `structured_live` systems | 7 of 9 | upper_limb, lower_limb, spine, respiratory, renal, gastro_digestive, hearing |
| `legacy` systems | 2 of 9 | cns, visual — all 4 components wired, mode blocked by ADR-0002 |
| All 4 policy fixes applied | ✓ CONFIRMED | §1 CNS Section B, §2 visual diplopia, §3 gastro subsystems, §4 renal inputs |
| ADR-0001 calibration reports | ✓ 7 of 9 | All 7 live systems meet per-system thresholds |
| `validateSystemRegistry()` wired at startup | ✓ | `src/server.ts` calls it before accepting requests |
| `validateStructuredLivePromotion()` in CI | ✓ | `systemRegistry.test.ts` calls it; checks allowlist + evidence |
| No-tool-no-PI guard (`src/v2/guards.ts`) | ✓ | Typed `V2RenderedResponse` validator + legacy regex guard both present |
| `policyEngine.ts` structured-live branch | ✓ | D8 confirmation branch (lines 190–300), instance-aware readiness wired |
| `chatServiceV2.ts` mode-branching | ✓ | Structured / legacy extraction branched by registry mode at line 687 |
| Excel shadow runner infrastructure | ✓ | 8 shadow test files, `scenarios.generated.json` (3 MB), calibration reports |
| `structured_shadow` runtime phase | — SKIPPED | All 7 systems went from `legacy` directly to `structured_live` via calibration |
| Sprint 7 (hardening / legacy disable) | NOT STARTED | Blocked until Sprint 6 (CNS + Visual) completes |

**Lower limb caution:** ADR-0001 gate cleared at 85.7% safe-outcome (threshold 85%)
and 72.4% exact-calc (threshold 70%) on n=1164 rows — both are borderline passes.
Monitor for regressions; this system is the most at risk of demotion if extractor
coverage regresses.

---

## Registry mode lifecycle

A GATIOD body system moves through three registry modes. Each transition is a
one-line edit to `V2_SYSTEM_REGISTRY` in `src/v2/systemRegistry.ts`, but is only
permitted when specific evidence gates have been cleared.

```mermaid
flowchart LR
    L(["legacy"])
    SS(["structured_shadow"])
    SL(["structured_live"])

    L -->|"Steps 1-4\nwire + golden tests"| SS
    SS -->|"Steps 5-6\nrelease cycle + ADR-0001"| SL
    SL -.->|"rollback\nv2_system_rolled_back"| SS
    SS -.->|"hard rollback"| L

    style L fill:#f5f5f5,stroke:#9e9e9e
    style SS fill:#fff8e1,stroke:#f9a825
    style SL fill:#e8f5e9,stroke:#388e3c
```

| Mode | Who owns `V2SystemState`? | Where structured output goes |
|---|---|---|
| `legacy` | Legacy `extractSignals()` path | Nowhere — components wired but not invoked |
| `structured_shadow` | Legacy (still authoritative) | Audit log only (`v2_extractor_shadow` event) |
| `structured_live` | Structured pipeline | `V2SystemState`, confirmation, PI% |

---

## What shadow mode is for

**The problem it solves:** clinical PI% calculations have medico-legal consequences.
Shadow mode lets the new structured pipeline run against live production traffic and
have its correctness *measured* before it owns state. The doctor sees no change in
behaviour — the system still calculates via legacy.

### What happens in a single turn while `structured_shadow`

```mermaid
sequenceDiagram
    participant D as Doctor
    participant CS as chatServiceV2
    participant LP as Legacy Path
    participant SE as Structured Extractor
    participant VS as V2SystemState
    participant AL as Audit Log

    D->>CS: utterance

    Note over CS,VS: Legacy path — authoritative
    CS->>LP: extractSignals() / extractValues()
    LP-->>VS: state update (slot signals, extractedValues)

    Note over CS,AL: Shadow path — GATIOD_EXTRACTOR_SHADOW=true
    CS->>SE: extractor(utterance, systemState)
    SE-->>AL: v2_extractor_shadow event
    Note over AL: records legacy result + structured result for divergence analysis
    Note over VS: V2SystemState unchanged by structured output

    CS-->>D: response (legacy-driven)
```

- **Only the legacy path updates `V2SystemState`.** Structured output goes to
  audit logs only — it never touches state, confirmation, or PI%.
- Gate: `process.env.GATIOD_EXTRACTOR_SHADOW === "true"`.
- Anti-pattern (D5): running both paths and letting both update authoritative
  state creates split-brain (legacy says "ROM captured", structured says "bare
  90° unresolved").

### Current registry state (CNS and Visual)

CNS and Visual have all four capability components wired but their mode is still
`"legacy"` — not yet `"structured_shadow"`. The registry comments say **"pending
ADR-0001 calibration."** The components exist and can run but have not entered
the shadow comparison phase (ADR-0002 is the open decision on timing).

---

## The full process: legacy → structured_shadow → structured_live

```mermaid
flowchart TD
    START(["System starts as legacy"])
    BUILD["Step 1\nBuild 4 components + policy fixes"]
    WIRE["Step 3\nWire into registry\nmode: legacy"]
    GOLDEN["Step 4\nWrite 15-25 golden tests"]
    GT_GATE{"100% pass?"}
    FLIP_SS["Step 5\nFlip to structured_shadow\nRun 1+ release cycle"]
    DIV_GATE{"Shadow divergence\nwithin threshold?"}
    EXCEL["Step 6\nRun Excel shadow runner\nGATIOD_RUN_EXCEL_SCENARIOS=true"]
    ADR_GATE{"ADR-0001 thresholds met\n+ zero safety failures?"}
    FLIP_SL["Step 7\nFlip to structured_live\nRun both validation checks"]
    DONE(["structured_live active"])

    START --> BUILD
    BUILD --> WIRE
    WIRE --> GOLDEN
    GOLDEN --> GT_GATE
    GT_GATE -->|"No — fix and rerun"| GOLDEN
    GT_GATE -->|Yes| FLIP_SS
    FLIP_SS --> DIV_GATE
    DIV_GATE -->|"No — fix extractor"| FLIP_SS
    DIV_GATE -->|Yes| EXCEL
    EXCEL --> ADR_GATE
    ADR_GATE -->|"No — fix and rerun"| EXCEL
    ADR_GATE -->|Yes| FLIP_SL
    FLIP_SL --> DONE
    DONE -.->|"elevated failure rate\nrollback"| FLIP_SS

    style START fill:#f5f5f5,stroke:#9e9e9e
    style FLIP_SS fill:#fff8e1,stroke:#f9a825
    style FLIP_SL fill:#e3f2fd,stroke:#1976d2
    style DONE fill:#e8f5e9,stroke:#388e3c
    style GT_GATE fill:#fffde7,stroke:#f9a825
    style DIV_GATE fill:#fffde7,stroke:#f9a825
    style ADR_GATE fill:#fffde7,stroke:#f9a825
```

---

### Step 1 — Build the four capability components

The four components form an assessment pipeline. The diagram below shows how
data flows through them at assessment time (structured_live path only).

```mermaid
flowchart LR
    U["Utterance\n+ V2SystemState"] --> EX["Structured\nExtractor"]

    EX -->|"extractedFactsPatch"| EF[("extractedFacts\ncalculation-grade")]
    EX -->|"pendingObservationsToAdd"| PO[("pendingObservations\nnot yet resolvable")]

    EF & PO --> RV["Readiness\nValidator"]
    RV -->|"ready: false\nblockers present"| CQ["Clarification\nquestion + chips"]
    RV -->|"ready: true\nno pending obs"| AB["Arg\nBuilder"]

    AB -->|"Zod safeParse"| ZV{"Schema\nvalid?"}
    ZV -->|"ok: false\nZod issues"| VF["V2FailureResponse\nschema_validation_failed"]
    ZV -->|"ok: true + provenance"| TOOL["assess_* tool\nexecution"]

    TOOL --> RR["Result\nRenderer"]
    RR --> AR["AssessmentRenderResult\nsummary + full breakdown"]

    style EF fill:#e8f5e9,stroke:#388e3c
    style PO fill:#fff8e1,stroke:#f9a825
    style CQ fill:#e3f2fd,stroke:#1976d2
    style VF fill:#ffebee,stroke:#c62828
    style AR fill:#e8f5e9,stroke:#388e3c
```

| Component | Module | Key contract |
|---|---|---|
| **Structured extractor** | `src/v2/extractors/<system>.ts` | Enforces D2 inference boundary — never infers ROM direction, deficit type, severity bracket, or final PI%. Unresolved data → `pendingObservations`, not `extractedFacts`. |
| **Readiness validator** | `src/v2/readiness/<system>.ts` | Blocks when `pendingObservations.length > 0` or required facts missing. System-specific gates live here (ROM-from-nerve, ASIA→monoparesis, asthma prereqs, etc.). |
| **Arg builder** | `src/v2/argBuilders/<system>.ts` | Reads only `extractedFacts`. Calls `<System>ValueSchema.safeParse`. Zero-fills absent streams explicitly. Populates `provenance.builderZeroFilled` vs `provenance.userSupplied`. Side is a required clinical fact — never defaulted. |
| **Result renderer** | `src/v2/renderers/<system>Result.ts` | Deterministic, progressive. Auto-expands on DBE/ROM conflict, amputation suppression, multi-stream CVC, cap applied, doctor PI deviation. API always returns full breakdown object. |

---

### Step 2 — Apply applicable policy fixes

[policy-fixes.md](policy-fixes.md) lists four pre-existing bugs in `slotEvaluator.ts`
that must be corrected *inside* the corresponding structured extractor. Do not apply
them to legacy slot policy in isolation — the fix lands with the extractor so both
agree on what the slot signals mean.

| Fix | System | Sprint |
|---|---|---|
| §1 — CNS Section B: chips must be olfaction / facial nerve / equilibrium / swallowing / station-gait / respiration (not bladder/bowel — those are spine) | CNS | Sprint 6, V2-501 |
| §2 — Visual diplopia: chips must be angular zones (uncorrectable / central 30° / 30–60° / beyond 60°), not monocular/binocular | Visual | Sprint 6, V2-504 |
| §3 — Gastro subsystems: must include upper GI and hernia (not just colon/rectum and liver/biliary) | Gastro | Sprint 5, V2-401 |
| §4 — Renal: eGFR not accepted by engine; ask for creatinine clearance / CKD stage / clinical severity | Renal | Sprint 4, V2-303 |

---

### Step 3 — Wire components into registry with `mode: "legacy"`

Add the four components to `V2_SYSTEM_REGISTRY[system]` but keep `mode: "legacy"`.
`validateSystemRegistry()` only enforces wiring for `structured_live` systems, so
this step is safe. The components exist but do not execute.

---

### Step 4 — Write golden tests

Location: `tests/v2/<system>/` — **15–25 conversation-level tests**, hand-picked
for clinical criticality. Required coverage:

- Happy path (all fields provided, correct confirmation and PI%)
- Every blocking clarification case (missing side, bare angle without direction,
  missing severity bracket, etc.)
- System-specific edge cases (ROM-from-nerve gate, ankylosis, monoparesis,
  diplopia zone, CNS Section A/B/C, etc.)
- Stale confirmation after a fact patch
- Schema validation failure → `V2FailureResponse{ failureKind: "schema_validation_failed" }`
- Full failure-choice flow (review findings / retry structured / use legacy)
- No-tool-no-PI guard: lookup path must not use final PI% language

Golden tests must pass at **100%**. This is a hard gate.

---

### Step 5 — Run in `structured_shadow` for at least one release cycle

Flip `mode: "structured_shadow"` in the registry. The extractor now runs in
parallel with legacy on real traffic. Audit logs accumulate `v2_extractor_shadow`
events. This phase must run for **at least one release cycle** before promotion.

During this phase, compare shadow output against legacy output in audit logs.
Divergence above an agreed threshold blocks promotion.

---

### Step 6 — Run the Excel scenario shadow runner (ADR-0001)

The canonical scenario workbook `data/gatiod_injury_scenario_catalogue.xlsx`
covers 1,148 scenarios, 2,419 specific rows, 360 cross-system rows.

Shadow runner: `tests/v2/excelScenarios/*.shadow.test.ts`
Opt-in: `GATIOD_RUN_EXCEL_SCENARIOS=true`
Fixtures: `scripts/build-excel-fixtures.ts` → `scenarios.generated.json`
(CI fails if fixture is stale after regeneration)

#### How each row component is classified and gated

```mermaid
flowchart TD
    ROW["Row component\none entry per system per scenario row"]

    ROW --> EC["exact_calculation\nExtracted facts produce expected PI%"]
    ROW --> CR["clarification_required\nAsked correct missing-field question"]
    ROW --> USF["unsupported_safe_fail\nRefused or deferred safely"]
    ROW --> RO["routing_only\nIdentified correct system, no calc"]
    ROW --> LD["legacy_deferred\nSystem intentionally legacy\nExcluded from all gates"]

    EC & CR & USF & RO --> METRICS["Compute per-system metrics\nexcluding legacy_deferred rows"]
    LD --> SKIP["Does not count\nagainst any gate"]

    METRICS --> SAFE_CHK{"component_safe_outcome_rate\nmeets threshold?"}
    SAFE_CHK -->|No| FAIL_S["FAIL\nrates below threshold"]
    SAFE_CHK -->|Yes| EXACT_CHK{"exact_calculation_rate\nmeets threshold?\nif exact rows exist"}
    EXACT_CHK -->|No| FAIL_E["FAIL\nrates below threshold"]
    EXACT_CHK -->|Yes| ZERO_CHK{"Zero critical\nsafety failures?"}
    ZERO_CHK -->|No| FAIL_Z["FAIL\ndisqualifying safety event"]
    ZERO_CHK -->|Yes| PROMO(["validateStructuredLivePromotion\nok: true — promotion allowed"])

    style EC fill:#e8f5e9,stroke:#388e3c
    style CR fill:#e3f2fd,stroke:#1976d2
    style USF fill:#f3e5f5,stroke:#7b1fa2
    style RO fill:#e0f7fa,stroke:#0097a7
    style LD fill:#f5f5f5,stroke:#9e9e9e
    style PROMO fill:#e8f5e9,stroke:#388e3c
    style FAIL_S fill:#ffebee,stroke:#c62828
    style FAIL_E fill:#ffebee,stroke:#c62828
    style FAIL_Z fill:#ffebee,stroke:#c62828
    style SAFE_CHK fill:#fffde7,stroke:#f9a825
    style EXACT_CHK fill:#fffde7,stroke:#f9a825
    style ZERO_CHK fill:#fffde7,stroke:#f9a825
```

#### Per-system promotion thresholds

| System | Safe-outcome ≥ | Exact-calculation ≥ |
|---|---:|---:|
| Hearing | 95% | 90% |
| Spine | 95% | 90% |
| Respiratory | 90% | 80% |
| Renal | 90% | 80% |
| Gastro-digestive | 85% | 70% |
| Upper limb | 85% | 70% |
| Lower limb | 85% | 70% |
| CNS | deferred (ADR-0002) | deferred |
| Visual | deferred (ADR-0002) | deferred |

**Disqualifying safety failures** (any one blocks promotion regardless of aggregate rates):

- Final PI% produced without a successful `assess_*` tool execution
- Confirmation offered with incomplete required facts
- Wrong system selected when explicit evidence exists for another
- Multi-system component silently dropped
- `argBuilder` validation bypassed
- Legacy fallback invoked without explicit doctor choice after a V2 failure

---

### Step 7 — Flip to `structured_live` and rollback

```mermaid
flowchart TD
    FLIP["Flip mode to structured_live\nin V2_SYSTEM_REGISTRY"]
    VSR{"validateSystemRegistry\nall 4 components present?"}
    VPE{"validateStructuredLivePromotion\nADR-0001 evidence at threshold?"}
    SMOKE["Smoke test /api/chat/v2"]
    LIVE(["structured_live active"])
    RB["ROLLBACK\nflip mode back to structured_shadow\nDO NOT delete the 4 components"]
    RBAL["Audit: v2_system_rolled_back"]
    INV["Investigate via shadow logs\n+ failure audit trail"]
    FFIX["Fix root cause"]
    REVERIFY["Re-verify Steps 5-6"]

    FLIP --> VSR
    VSR -->|"Missing component\nserver throws on startup"| FIX1["Fix missing component"]
    FIX1 --> VSR
    VSR -->|Pass| VPE
    VPE -->|"Fail — build blocked"| FIX2["Fix evidence gap\nrerun shadow runner"]
    FIX2 --> VPE
    VPE -->|Pass| SMOKE
    SMOKE --> LIVE

    LIVE -->|"Elevated v2_failure rate\nor doctor complaints"| RB
    RB --> RBAL
    RBAL --> INV
    INV --> FFIX
    FFIX --> REVERIFY
    REVERIFY --> FLIP

    style LIVE fill:#e8f5e9,stroke:#388e3c
    style RB fill:#ffebee,stroke:#c62828
    style RBAL fill:#fff8e1,stroke:#f9a825
    style VSR fill:#fffde7,stroke:#f9a825
    style VPE fill:#fffde7,stroke:#f9a825
```

Do not delete the four capability components on rollback. The shadow path keeps
them exercised, and they are required to re-promote without rebuilding from scratch.

---

## Stage-level inter-system gates

Beyond individual system gates, each rollout stage requires additional evidence
before the default `/api/chat` route switches for that cohort.

```mermaid
flowchart LR
    ST0["Stage 0\nAll legacy\nV2 shadow only"]
    ST1["Stage 1\nUpper limb shadow\nOthers legacy"]
    ST2["Stage 2\nUpper limb LIVE\nOthers legacy"]
    ST3["Stage 3\nLimbs + spine LIVE\nOthers legacy"]
    ST4["Stage 4\nAll systems LIVE"]
    ST5["Stage 5\nLegacy disabled\nexcept admin + fallback"]

    ST0 -->|"Per-system gates\ncleared"| ST1
    ST1 -->|"Shadow 99% agreement\nno severity>advisory failures"| ST2
    ST2 -->|"Lower limb + spine pass\nupper-limb fallback <2%"| ST3
    ST3 -->|"Remaining systems pass\npolicy-fixes all applied"| ST4
    ST4 -->|"1+ full release cycle\naggregate fallback OK"| ST5

    style ST0 fill:#f5f5f5,stroke:#9e9e9e
    style ST1 fill:#fff8e1,stroke:#f9a825
    style ST2 fill:#e3f2fd,stroke:#1976d2
    style ST3 fill:#e3f2fd,stroke:#1976d2
    style ST4 fill:#e8f5e9,stroke:#388e3c
    style ST5 fill:#e8f5e9,stroke:#1b5e20
```

| Transition | Additional gate |
|---|---|
| Stage 1 → 2 | Shadow comparison ≥ 99% PI% agreement for upper limb; no `v2_failure` events severity > advisory |
| Stage 2 → 3 | Lower limb + spine clear per-system gates; upper-limb legacy fallback rate < 2% of confirmed assessments |
| Stage 3 → 4 | All remaining systems (respiratory, renal, gastro, hearing, CNS, visual) clear per-system gates; all `policy-fixes.md` entries applied |
| Stage 4 → 5 | All systems in `structured_live` for ≥ one full release cycle; aggregate legacy fallback rate below agreed threshold; `/api/chat/legacy` admin override ready |

---

## Pre-switch checklist

Before flipping any system to `structured_live`, all of the following must be verified:

```
□ Four components built: extractor, readinessValidator, argBuilder, resultRenderer
□ Applicable policy-fixes.md entries incorporated in the extractor
□ Components wired to registry with mode: "legacy" (safe, non-activating)
□ Golden tests pass at 100% (15–25 clinically critical conversations)
□ No-tool-no-PI guard wired and passing tests
□ Audit trail records confirmed facts, tool args (with provenance), and result
□ validateSystemRegistry() passes at server startup (CI smoke test)
□ Ran in structured_shadow for ≥ one release cycle
□ Shadow audit logs compared vs legacy — divergence within agreed threshold
□ Excel shadow runner passes per-system thresholds
□ Zero critical safety failures in curated + shadow runs
□ validateStructuredLivePromotion(evidence) returns { ok: true }
□ Stage-level gate met (legacy fallback rate, upstream system stability)
```

---

## The two validation functions

These are separate and complementary — neither substitutes for the other.

```mermaid
flowchart TD
    subgraph RT["validateSystemRegistry() — server startup"]
        R_IN(["structured_live system starting up"])
        R_CHK{"All 4 components\npresent?"}
        R_FAIL["throws Error\nserver does not start"]
        R_PASS["startup proceeds"]

        R_IN --> R_CHK
        R_CHK -->|No| R_FAIL
        R_CHK -->|Yes| R_PASS
    end

    subgraph CI["validateStructuredLivePromotion(evidence) — CI only"]
        CI_IN(["structured_live system in CI"])
        CI_EV{"evidence reader\nprovided?"}

        CI_ALP{"on PROVISIONAL\nSTRUCTURED_LIVE?"}
        CI_ALW["WARN: provisional\npending Excel evidence"]
        CI_ALF["FAIL: no ADR-0001\npromotion evidence"]

        CI_DEF{"thresholds = null\ndeferred?"}
        CI_DEFW["WARN: deferred\nper ADR-0002"]
        CI_REP{"calibration report\nexists?"}
        CI_REPF["FAIL: run\nnpm run test:excel-shadow"]
        CI_THR{"rates meet\nthresholds?"}
        CI_THRF["FAIL: below threshold"]
        CI_THRP(["ok: true\nPromotion allowed"])

        CI_IN --> CI_EV
        CI_EV -->|"No: allowlist mode"| CI_ALP
        CI_ALP -->|Yes| CI_ALW
        CI_ALP -->|No| CI_ALF
        CI_EV -->|"Yes: evidence mode"| CI_DEF
        CI_DEF -->|Yes| CI_DEFW
        CI_DEF -->|No| CI_REP
        CI_REP -->|No| CI_REPF
        CI_REP -->|Yes| CI_THR
        CI_THR -->|No| CI_THRF
        CI_THR -->|Yes| CI_THRP
    end

    style R_FAIL fill:#ffebee,stroke:#c62828
    style R_PASS fill:#e8f5e9,stroke:#388e3c
    style CI_ALW fill:#fff8e1,stroke:#f9a825
    style CI_DEFW fill:#fff8e1,stroke:#f9a825
    style CI_ALF fill:#ffebee,stroke:#c62828
    style CI_REPF fill:#ffebee,stroke:#c62828
    style CI_THRF fill:#ffebee,stroke:#c62828
    style CI_THRP fill:#e8f5e9,stroke:#388e3c
    style R_CHK fill:#fffde7,stroke:#f9a825
    style CI_EV fill:#fffde7,stroke:#f9a825
    style CI_ALP fill:#fffde7,stroke:#f9a825
    style CI_DEF fill:#fffde7,stroke:#f9a825
    style CI_REP fill:#fffde7,stroke:#f9a825
    style CI_THR fill:#fffde7,stroke:#f9a825
```

| | `validateSystemRegistry()` | `validateStructuredLivePromotion(evidence)` |
|---|---|---|
| **When** | Server startup (runtime) | CI only |
| **Checks** | All four components are wired | ADR-0001 calibration evidence at or above threshold |
| **On failure** | Throws — server does not start | Returns `{ ok: false, failures: [...] }` |
| **Speed** | Fast, no fixtures required | Requires calibration reports from shadow runner |

Runtime startup must be fast and must not require loading the Excel fixture.
Engineering cannot substitute one for the other.
