# V2 Architecture Decisions

This document records the 12 binding architectural decisions reached during planning. Each decision was reached through explicit grilling against the codebase and is not optional. If you need to deviate, document the reason and update this file.

---

## D1 — Phase ordering

**Decision:** Reorder phases so implementation sequence matches the dependency chain.

```
1. extractedFacts model
2. structured extractors / fact builders
3. readiness validators
4. confirmation renderer (backed by structured facts)
5. toolArgBuilder
6. direct assess_* execution (replaces delegate_legacy)
7. deterministic result renderer
8. no-tool-no-PI guard
9. policy mismatch fixes (CNS, visual, gastro, renal) + lookup wording
10. golden tests + rollout gates
```

**Why:** A developer picking up "Phase 1" must be able to start without discovering hidden prerequisites. Building `toolArgBuilder` before `extractedFacts` would force a brittle parser over display strings.

**Implementation rule:** *Do not build tool arguments from display strings. Build them from confirmed structured facts.*

---

## D2 — Ambiguous extraction policy

**Decision:** Four extraction states. The structured extractor must not infer clinical fields.

| State | Meaning | Calculable? |
|---|---|---|
| `structured` | All required fields explicit | Yes (after confirmation) |
| `partial` | Some structured facts known, one required field missing | No |
| `ambiguous` | Multiple interpretations possible | No |
| `unsupported` | Cannot map to current schema | No |

**Inference boundary:**

| Field type | May regex/LLM infer? |
|---|---|
| Body system | Yes (with confidence) |
| Side | Yes (if explicitly stated) |
| Joint / body part | Yes (if explicitly stated) |
| Numeric value | Yes (if explicitly stated) |
| ROM direction | **No — must be stated or user-selected** |
| Deficit type / loss type | **No — must be stated or user-selected** |
| Severity bracket | **No — must be stated or user-selected** |
| Final PI% | **Never inferred** |

**Example:** `"left shoulder 90 degrees"` → store joint and angle in `pendingObservations`, ask "Which shoulder movement does 90° apply to?" with chips. **Do not** assume flexion and ask for confirmation.

---

## D3 — Unresolved observation state

**Decision:** Separate `pendingObservations` from `extractedFacts`. Facts graduate from observations only after the user supplies the missing field.

```ts
interface V2SystemState {
  status: V2SystemStatus;
  completeness: number;
  pendingFields: string[];
  slotSignals: Partial<SlotSignals>;
  extractedValues: Record<string, string>;     // display/debug only
  extractedFacts: V2SystemFacts;                // calculation-grade only
  pendingObservations: PendingObservation[];    // not yet calculable
  confirmation: V2SystemConfirmation;
  piPercent: number | null;
  updatedAt: string;
}

interface PendingObservation {
  id: string;
  system: GatiodSystemKey;
  type: "rom_measurement" | "nerve_deficit" | "dbe_condition"
      | "severity_bracket" | "hearing_value" | "visual_value" | "other";
  sourceText: string;
  parsed: Record<string, unknown>;
  missingFields: string[];
  clarificationQuestion: string;
  candidateAnswers?: string[];
  createdAt: string;
  updatedAt: string;
}
```

**Invariant:** `toolArgBuilder` reads only `extractedFacts`. `readinessValidator` blocks whenever `pendingObservations.length > 0`.

---

## D4 — Confirmation model (factsHash snapshot)

**Decision:** Remove `confirmed` from `ExtractedFact<T>`. Use system-level confirmation with a hash of the confirmed snapshot.

```ts
interface ExtractedFact<T> {
  value: T;
  sourceText: string;
  confidence: number;
  extractionMethod: "regex" | "llm_proposed_validated" | "user_selected";
  createdAt: string;
  updatedAt: string;
  // No confirmed flag — confirmation is system-level
}

interface V2SystemConfirmation {
  status: "not_confirmed" | "pending" | "confirmed" | "stale";
  confirmedAt?: string;
  confirmedBy?: string;
  confirmationSummary?: string;
  factsHash?: string;
}
```

**Execution guard:**

```ts
function canExecuteAssessment(systemState: V2SystemState): boolean {
  if (systemState.pendingObservations.length > 0) return false;
  if (systemState.confirmation.status !== "confirmed") return false;
  return hashExtractedFacts(systemState.extractedFacts) === systemState.confirmation.factsHash;
}
```

**Invalidation:** Any fact patch must set `confirmation.status = "stale"` and clear `piPercent`.

---

## D5 — Pipeline migration (per-system branching)

**Decision:** Per-system branch via shared registry. No parallel live state sources.

```text
For a migrated system (structured_live):
  structured extractor → extractedFacts + pendingObservations + derived slot signals

For an unmigrated system (legacy):
  extractSignals() + extractValues() — current behaviour
```

**Anti-pattern:** Running both extraction paths and letting both update authoritative state. Creates split-brain (legacy says "ROM captured", structured says "bare 90° unresolved").

**Shadow mode is allowed for logs only**, gated on `process.env.GATIOD_EXTRACTOR_SHADOW === "true"`. Shadow output never updates state.

---

## D6 — Observation resolution gate

**Decision:** Session-mode gate before `retrieveGrounding()` and `routeUtterance()`.

```text
load V2 state
↓
normalise user message
↓
if pendingObservations.length > 0:
    try resolve pending observation
    if resolved → graduate to extractedFacts → continue to readiness/confirmation
    else → re-ask clarification with candidateAnswers as chips
↓
normal grounding / route / extractor / policy flow
```

**Why:** Short replies like `"Flexion"` lack context to route correctly. Routing first risks creating a duplicate partial observation.

**Resolver contract:**

```ts
interface PendingObservationResolutionResult {
  resolved: boolean;
  blocked: boolean;
  state: V2SessionState;
  system?: GatiodSystemKey;
  observationId?: string;
  clarificationQuestion?: string;
  candidateAnswers?: string[];
  auditEvent?: Record<string, unknown>;
}
```

**Compound replies** (e.g. `"Flexion, and abduction is also 80"`) — for sprint 1, resolve only the pending observation and ask whether to add more. Defer residual extraction to a later sprint with audit events `pending_observation_resolved` + `residual_text_extracted`.

---

## D7 — toolArgBuilder design

**Decision:** Explicit zero values for absent streams. Always validate via the engine's Zod schema. Never use `defaultUpperLimbValue()` as the builder base.

```ts
interface BuildResultOk<T> {
  ok: true;
  toolName: string;
  args: T;
  warnings: string[];
  provenance: {
    userSupplied: string[];        // facts from confirmed extraction
    builderZeroFilled: string[];   // streams the builder zero-filled
    factsHash: string;
  };
}
```

**Rules:**

1. Side is a required clinical fact, not a zero-value field. Never default it (e.g. `facts.side?.value ?? "right"` is forbidden).
2. Absent findings (no amputation, no nerve, no DBE) are zero-filled by the builder explicitly:
   ```ts
   amputations: { armLevel: "none", fingers: { thumb: "none", index: "none", middle: "none", ring: "none", little: "none" } }
   rom: { joints: {} }
   neurological: { selectedNerves: [], romFromNerve: false }
   dbe: { selectedConditions: [] }
   ```
3. `UpperLimbValueSchema.safeParse(args)` must pass. On failure, return `ok: false` with Zod issue messages as warnings.
4. Provenance must distinguish user-supplied from builder-zero-filled fields (medico-legal audit requirement).

---

## D8 — Confirmation handling location

**Decision:** Modify `policyEngine.ts` to handle confirmation for migrated systems. Add a small extraction-skip guard in `chatServiceV2.ts` for pure confirmation replies.

**`policyEngine.ts` confirmation branch (replaces lines 81–96):**

```ts
if (state.pendingConfirmation && isConfirmation(normalized)) {
  const system = state.pendingConfirmation.system;

  if (isStructuredLiveSystem(system)) {
    const cap = requireStructuredCapability(system);
    const systemState = state.systems[system];

    const readiness = cap.readinessValidator(systemState);
    if (!readiness.ready) return clarificationFromReadiness(readiness);

    if (!hashMatches(systemState, state.pendingConfirmation)) {
      return staleConfirmationDecision(system, systemState);
    }

    const built = cap.argBuilder(systemState.extractedFacts);
    if (!built.ok) return clarificationFromBuildFailure(built);

    return {
      action: "execute_tools",
      reason: "Confirmed structured V2 assessment; executing deterministic tool.",
      requiresConfirmation: false,
      proposedTools: [{
        name: built.toolName,
        args: built.args,
        status: "proposed",
        validation: { ok: true, message: "Validated structured V2 payload." },
        provenance: built.provenance,
      }],
    };
  }

  return legacyConfirmationDecision(system);
}
```

**`chatServiceV2.ts` extraction-skip guard:**

```ts
const confirmationReply = loadedState.pendingConfirmation && isConfirmation(normalized);
if (primarySystem && !confirmationReply) {
  // run structured or legacy extractor based on registry mode
}
```

**Why this split:** Confirmation is a *policy* decision. Tool dispatch is a *transport* concern. `chatServiceV2.ts` already executes `policy.action === "execute_tools"`; reuse that path.

---

## D9 — Result renderer (progressive)

**Decision:** Concise summary by default. Inline breakdown auto-triggered for exception cases. API always returns full breakdown object.

**Default message (single-stream simple case):**

```text
System-generated GATIOD PI%: 8%

Upper limb — left:
- ROM stream: 8%
- No amputation, nerve deficit, or DBE condition included.

Final PI%: 8%
View full calculation breakdown?
```

**Auto-expand inline when any of:**
- DBE/ROM conflict resolved
- Amputation suppression occurred
- CVC involved more than one non-zero stream
- A cap was applied
- Doctor-recommended PI% differs from system-generated PI%

**API response shape:**

```ts
interface AssessmentRenderResult {
  message: string;
  suggestedChips: string[];
  resultSummary: {
    system: GatiodSystemKey;
    side?: "left" | "right";
    finalPercent: number;
    categoryPercents: { amputation: number; rom: number; neurological: number; dbe: number };
  };
  fullBreakdown: {
    inputFacts: string[];
    categoryResults: { label: string; rawPercent: number; notes: string[] }[];
    dbeRomConflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[];
    cvcInputs: number[];
    cvcTrace: string[];
    capsApplied: string[];
    rulesApplied: string[];
    finalPercent: number;
  };
  displayMode: "summary" | "expanded";
}
```

**Hard rule:** Never let the LLM rewrite "System-generated GATIOD PI%: X%" or "Final PI%: X%". These come from the deterministic renderer only.

---

## D10 — No-tool-no-PI guard (two-layer)

**Decision:** Typed semantic validation for V2 renderers. Regex guard for legacy/LLM free text.

**Response classification:**

```ts
type V2ResponseKind =
  | "clarification"
  | "confirmation"
  | "lookup_only"
  | "assessment_result"
  | "global_result"
  | "error";

interface V2RenderedResponse {
  kind: V2ResponseKind;
  message: string;
  suggestedChips?: string[];
  toolEvidence?: { toolName: string; status: "executed" | "failed"; success: boolean; resultHash?: string };
  numericClaims: Array<{ label: string; value: number; unit: "%"; authority: "lookup_only" | "assessment_result" }>;
}
```

**Validator:**

```ts
function validateRenderedResponse(r: V2RenderedResponse): GuardResult {
  const hasFinalPiLanguage = /\b(system-generated\s+GATIOD\s+PI|final\s+PI|total\s+PI|overall\s+PI)\s*:?\s*\d+(?:\.\d+)?\s*%/i.test(r.message);
  const hasSuccessfulAssessmentTool = r.toolEvidence?.success === true && /^assess_/.test(r.toolEvidence.toolName);

  if ((r.kind === "assessment_result" || r.kind === "global_result" || hasFinalPiLanguage) && !hasSuccessfulAssessmentTool) {
    return { ok: false, reason: "Final PI% language requires successful assess_* tool evidence." };
  }

  if (r.kind === "lookup_only") {
    if (/\b(final\s+PI|system-generated\s+GATIOD\s+PI|total\s+PI|overall\s+PI)\b/i.test(r.message)) {
      return { ok: false, reason: "Lookup responses must not use final PI% language." };
    }
  }

  return { ok: true };
}
```

**Lookup wording:**

- Good: `"Lookup only — not a final PI assessment. Shoulder flexion 90° maps to a ROM table value of 5%."`
- Bad: `"Final PI%: 5%"` or `"approximately 5%"` (avoid "approximately" for table values).

**Legacy regex guard (still applies to `processChat` output):**

```ts
/\b(?:PI|permanent incapacity|incapacity|final|total).{0,50}\b\d+(?:\.\d+)?\s*%/i
```

---

## D11 — V2 failure fallback policy

**Decision:** Fail loud. No silent fallback. Doctor explicitly chooses retry or legacy.

```ts
type V2FailureKind =
  | "readiness_failed"
  | "stale_confirmation"
  | "arg_builder_failed"
  | "schema_validation_failed"
  | "tool_execution_failed"
  | "renderer_failed"
  | "guard_failed";

interface V2FailureResponse {
  kind: "v2_failure";
  failureKind: V2FailureKind;
  message: string;
  suggestedChips: string[];
  allowLegacyFallback: boolean;
  auditRef?: string;
}
```

**User-facing message:**

```text
I could not complete the structured V2 calculation for this confirmed assessment.

Reason: [specific failure detail]

No PI% has been generated.

You can:
- Review the confirmed findings
- Retry the structured calculation
- Use legacy assessment mode for this case
```

**Chips:** `Review findings | Retry structured calculation | Use legacy mode`

**Legacy fallback only on explicit doctor selection.** When invoked, build a fallback prompt that includes the confirmed V2 summary so legacy doesn't rely on incomplete chat history. Log audit events:

```text
v2_failure
v2_failure_user_choice
v2_legacy_fallback_requested
v2_legacy_fallback_result
```

---

## D12 — System migration registry (shared source of truth)

**Decision:** Single registry imported by both `policyEngine.ts` and `chatServiceV2.ts`.

**Module:** `src/v2/systemRegistry.ts`

```ts
export type SystemMigrationMode = "legacy" | "structured_shadow" | "structured_live";

export interface V2SystemCapability {
  system: GatiodSystemKey;
  mode: SystemMigrationMode;
  extractor?: StructuredExtractor;
  readinessValidator?: ReadinessValidator;
  argBuilder?: ToolArgBuilder;
  resultRenderer?: ResultRenderer;
}

export const V2_SYSTEM_REGISTRY: Record<GatiodSystemKey, V2SystemCapability> = {
  upper_limb: { system: "upper_limb", mode: "legacy" /* → flip to structured_live in sprint 1 */ },
  lower_limb: { system: "lower_limb", mode: "legacy" },
  spine:      { system: "spine", mode: "legacy" },
  respiratory:{ system: "respiratory", mode: "legacy" },
  renal:      { system: "renal", mode: "legacy" },
  gastro_digestive: { system: "gastro_digestive", mode: "legacy" },
  hearing:    { system: "hearing", mode: "legacy" },
  cns:        { system: "cns", mode: "legacy" },
  visual:     { system: "visual", mode: "legacy" },
};

export function isStructuredLiveSystem(system: GatiodSystemKey): boolean {
  const cap = V2_SYSTEM_REGISTRY[system];
  return cap.mode === "structured_live"
    && Boolean(cap.extractor)
    && Boolean(cap.readinessValidator)
    && Boolean(cap.argBuilder)
    && Boolean(cap.resultRenderer);
}

export function requireStructuredCapability(system: GatiodSystemKey): Required<V2SystemCapability> {
  if (!isStructuredLiveSystem(system)) {
    throw new Error(`${system} is not a fully migrated structured V2 system.`);
  }
  return V2_SYSTEM_REGISTRY[system] as Required<V2SystemCapability>;
}

export function validateSystemRegistry(): void {
  for (const [system, cap] of Object.entries(V2_SYSTEM_REGISTRY)) {
    if (cap.mode !== "structured_live") continue;
    const missing = [
      !cap.extractor && "extractor",
      !cap.readinessValidator && "readinessValidator",
      !cap.argBuilder && "argBuilder",
      !cap.resultRenderer && "resultRenderer",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`${system} is structured_live but missing: ${missing.join(", ")}`);
    }
  }
}
```

**Startup integrity check:** `validateSystemRegistry()` must be called during server startup before accepting requests.

**Invariant:** A system is migrated only if the shared registry marks it `structured_live` AND provides all four components (`extractor`, `readinessValidator`, `argBuilder`, `resultRenderer`).
