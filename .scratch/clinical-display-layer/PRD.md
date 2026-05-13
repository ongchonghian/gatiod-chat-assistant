# Clinical Display Layer for Doctor-Facing Messages

Status: done
Category: enhancement

## Problem Statement

Doctors using the GATIOD chat assistant see raw system-internal identifiers in confirmation and disambiguation messages. When two extractor results disagree and the system presents both interpretations for the doctor to choose between, field names are shown as schema keys (e.g. `spine_region`, `spine_entries`, `monoparesisHalving`, `bladderBowelSeverity`) and complex values are serialised as raw JSON objects. Severity codes such as `disc31_persistent_motor_or_motor_sensory` appear verbatim instead of their clinical descriptions.

This creates unnecessary cognitive overhead for clinicians operating under time pressure. A doctor reading between patients should see clinical language that matches how they documented the case — not an internal data model they were never asked to learn.

The problem is most acute in the extractor comparison message (ADR-0004) but the same pattern recurs in the generic confirmation fallback path and in the expanded calculation breakdown shown after a result is rendered.

## Solution

Introduce a **clinical display layer** — a dedicated translation module that maps every system fact key, enum value, and complex fact value to a clinician-readable string. All doctor-facing rendering code (extractor comparison, confirmation builder, result renderers) calls this layer rather than using raw keys or `JSON.stringify` directly.

The layer is system-aware: a fact key like `spine_entries` renders differently from `rom_joints`, and a spine severity code renders as its full clinical description rather than its lookup key. The extractor comparison message is the first consumer; subsequent sprint work migrates the confirmation fallback and result renderer input-facts list.

From the doctor's perspective, the change is invisible in the happy path: they were already seeing clinical language for most messages. The fix closes the gap in the extractor comparison disambiguation flow, the generic confirmation fallback, and the expanded calculation breakdown, so that no message ever presents raw schema artefacts regardless of which code path was followed.

## User Stories

1. As a doctor, I want disambiguation messages to show clinical field labels (e.g. "Diagnosis", "Severity", "Region"), so that I can confirm or reject an interpretation without having to decode internal system names.
2. As a doctor, I want severity codes translated to their clinical descriptions (e.g. "Persistent motor or motor-sensory deficit" rather than `disc31_persistent_motor_or_motor_sensory`), so that I immediately recognise the finding being attributed to me.
3. As a doctor, I want spine diagnosis entries in disambiguation messages to show the same terse table format as the confirmation card (category → severity → modifiers), so that there is no visible difference in how a finding looks before and after I confirm it.
4. As a doctor, I want boolean modifiers shown in plain English ("Monoparesis halving applies" / "No monoparesis halving"), so that I understand what is and is not being attributed.
5. As a doctor, I want enum values translated to natural language (e.g. `lumbo_sacral` → "Lumbo-Sacral"), so that region labels read consistently throughout the conversation.
6. As a doctor, I want the extractor comparison message to highlight which field the two interpretations differ on in clinical terms (e.g. "These fields differ: Severity, Region"), so that I can scan directly to the point of disagreement.
7. As a doctor, I want the comparison footer "Both interpretations agree on all fields" / "These fields differ" to use clinical labels for the differing field names, so that I understand which aspect is in dispute.
8. As a doctor, I want ROM joint data displayed as joint-name and direction-angle pairs (e.g. "Hip: flexion 90°, extension 10°") rather than a raw JSON object, so that I can verify the measurement was captured correctly.
9. As a doctor, I want nerve deficit selections shown as named nerve groups rather than internal code arrays, so that I can confirm the correct nerve territories were identified.
10. As a doctor, I want lower-limb amputation level displayed as a clinical label (e.g. "Above knee") rather than an enum key, so that the confirmed finding reads naturally.
11. As a doctor, I want bladder/bowel severity shown as a clinical phrase (e.g. "Incomplete involvement — both sphincters") rather than a raw enum key, so that I can verify the correct modifier was applied.
12. As a doctor, I want disc cord involvement shown as a plain-language statement ("Cord involvement confirmed" / "No cord involvement"), so that the significance of the flag is immediately apparent.
13. As a doctor, I want spondylolysis pathway shown as "Pre-existing / superimposed" or "Acute traumatic" rather than an enum value, so that the injury type reads as I documented it.
14. As a doctor, I want the expanded calculation breakdown's input-facts list to show clinical labels and formatted values (not JSON), so that I can audit the inputs without needing to understand the data schema.
15. As a doctor, I want the confirmation card's generic fallback path (for systems not yet fully migrated) to show clinical labels rather than raw fact keys, so that partially-migrated systems present a consistent experience.
16. As a doctor, I want ASIA grade labels shown as their clinical names ("ASIA A — Complete", "ASIA D — Incomplete motor-functional") rather than bare codes, so that neurological severity is unambiguous.
17. As a doctor, I want the hearing assessment's affected ear shown as "Left", "Right", or "Both" (not `left`, `right`, `both`), so that laterality is immediately readable.
18. As a doctor, I want hearing AHL values displayed with their units (e.g. "Left ear AHL: 42 dB") rather than raw numbers, so that the measurement context is clear.
19. As a doctor, I want respiratory test results in the expanded breakdown to use clinical test names ("FVC", "FEV₁", "DLCO") and their classification labels, not raw enum values, so that I can verify the spirometry interpretation.
20. As a doctor, I want visual diplopia zone labels shown as clinical descriptions (e.g. "Central 30°") rather than enum keys, so that the affected zone is immediately recognisable.
21. As a doctor, I want all pending clarification questions in the comparison message to be indistinguishable in language and format from clarification questions asked outside the comparison flow, so that I do not have to context-switch between message types.
22. As a doctor, I want the comparison chips ("Use interpretation A", "Use interpretation B") to remain stable regardless of how many fields each interpretation captured, so that my choice is always a simple binary decision.
23. As a doctor, I want interpretation summaries to list missing or unresolved fields as "Not yet provided" rather than leaving them out entirely, so that I can see a complete picture of what each interpretation did and did not capture.
24. As a doctor reviewing a bilateral assessment, I want the bilateral mode flag displayed as "Same findings for both limbs" or "Separate findings per limb" rather than `same` / `separate`, so that the bilateral context is explicit.
25. As a doctor, I want all doctor-facing messages to be consistent in capitalization and terminology across every system (spine, limb, hearing, respiratory, etc.), so that the assistant feels like a single coherent tool.

## Implementation Decisions

### Module: Clinical Display Registry

A new deep module that serves as the single authoritative translation layer for doctor-facing display. It exposes:

- A **fact-key label resolver**: given a system key and a fact key, returns the human-readable field label. Labels are defined per-system; a shared fallback handles keys that are common across systems.
- A **fact-value formatter**: given a system key, a fact key, and a raw fact value, returns a human-readable string. Each system registers its own value formatter for complex types (e.g. spine entries array, ROM joints map); primitive types (strings, numbers, booleans, enums) are handled by a shared dispatcher that consults an enum label table.
- An **enum label table**: maps every enum value in the V2 data model to its clinical display string. This is the only place where strings like `lumbo_sacral → "Lumbo-Sacral"` or `disc31_persistent_motor_or_motor_sensory → "Persistent motor or motor-sensory deficit"` are defined.

The module's interface is intentionally narrow: two functions (label and format) take system + key + value and return strings. No other module should produce doctor-facing strings for structured fact data.

This is a deep module: it encapsulates all translation complexity behind a trivial two-function interface, can be unit-tested exhaustively in isolation, and has no side effects.

### Module: Extractor Comparison Formatter (existing `extractorComparison.ts`)

`formatExtractionSummary` is refactored to delegate all key and value rendering to the clinical display registry. The raw-key bullet format (`• **${k}**: ${display}`) is replaced by the registry's label for `k` and the registry's formatter for the value. The conflict-line in `buildComparisonOffer` similarly translates conflict key names to clinical labels before joining them.

No change to the comparison offer's data shape, chips, or resolution logic — only the rendered markdown strings change.

### Module: Confirmation Builder (existing `confirmationBuilder.ts`)

The generic fallback path (non-spine, non-hearing systems) currently emits raw fact keys and calls `JSON.stringify` for object values. This path is refactored to call the clinical display registry. Systems that already have bespoke body builders (spine, hearing) are not changed; the registry work targets the generic fallback only.

The spine-specific `buildSpineEntry` logic remains in the confirmation builder. The registry's spine value formatter delegates to this same logic to ensure confirmation cards and comparison messages produce identical output for spine entries.

### Module: Result Renderers (existing `renderers/*.ts`)

The `inputFacts` list inside `fullBreakdown` is constructed by iterating fact keys and calling `JSON.stringify`. Each renderer is updated to call the registry's label and formatter instead. This is the lowest-priority consumer; the change is mechanical once the registry exists.

### Interface contract

The registry module exports two pure functions:

```
factKeyLabel(system: GatiodSystemKey, factKey: string): string
factValueDisplay(system: GatiodSystemKey, factKey: string, value: unknown): string
```

These are the only public exports. Internal enum tables and per-system formatters are not exported.

### Schema alignment

No schema changes. The registry translates at read time; no stored data is modified. `ExtractedFact.value` types remain unchanged.

### Existing clinical label reuse

The confirmation builder already holds several correct clinical strings: `SPINE_REGION_LABELS`, `SPINE_BLADDER_BOWEL_LABELS`, `SYSTEM_LABELS`, and the `spineSeverityLabel` function (which delegates to `getSeveritiesForCategory`). These are migrated into the registry so they have a single canonical home. The confirmation builder and comparison formatter both import from the registry rather than defining their own copies.

## Testing Decisions

**What makes a good test here:** tests assert the human-readable output string produced for a given input (system key + fact key + value). They do not test internal tables or private helpers. A test should break if a clinical label is wrong or missing, and pass without modification if the internal implementation is restructured.

### Registry unit tests

The clinical display registry is the primary test target. Tests cover:

- Every system × every fact key → correct label string (no raw keys leaked)
- Representative enum values per system → correct clinical string (spot-check the most clinically significant codes: ASIA grades, spine severity keys, bladder/bowel severity, diplopia zones, amputation levels)
- Spine entries array (representative complete and partial entries) → correct formatted output matching the confirmation builder's existing spine body format
- ROM joints map (representative multi-joint cases) → correct formatted output (matching the existing `formatValue` ROM branch in `extractorComparison.ts`)
- Unknown keys → safe fallback (no crash; falls back to a sanitised version of the key)
- Unknown enum values → safe fallback (no crash; returns the raw value string)

Prior art: `tests/v2/sliceD.consensusResolver.test.ts` and `tests/v2/sliceG.extractionContext.test.ts` demonstrate the snapshot-assertion pattern used for rendered markdown strings. New registry tests follow the same style.

### Extractor comparison integration tests

Extend `tests/v2/sliceD.consensusResolver.test.ts` (or a new `sliceH.extractorComparison.test.ts`) to assert that:

- A comparison offer built from a realistic spine extraction result contains no raw JSON fragments, no raw fact keys, and no raw enum values in its `message` string
- The conflict-line names fields using their clinical labels
- A comparison offer with no conflicts produces the "Both interpretations agree on all fields" footer unchanged

### Confirmation builder regression tests

Add snapshot assertions for the generic fallback path (a system that hits the `default:` branch) to confirm that raw keys and JSON.stringify output no longer appear. The bespoke spine and hearing paths already have coverage; tests for those are not changed.

### No renderer tests in this PRD

Result renderer changes are mechanical; existing renderer snapshot tests cover the output format. Updating those snapshots after the renderer change constitutes the test.

## Out of Scope

- Changing the data types stored in `ExtractedFact.value` — the registry is a read-time translation layer only.
- Translating free-text `PendingObservation.clarificationQuestion` strings — these are already written in clinical language by the extractor.
- CNS and Visual system labels — these systems are not yet `structured_live`; their label registrations will be added when those systems are promoted (REQ-A1–REQ-A6).
- Translating the semantic consensus proposal message (`semanticInterpreterRenderer.ts`) — that renderer already writes clinical language; it does not use the fact registry.
- User-interface rendering (HTML/CSS, chip styling) — this PRD is backend message formatting only.
- Localisation or internationalisation.
- Any change to how facts are extracted, stored, or validated.

## Further Notes

The extractor comparison flow (ADR-0004) is the immediate trigger for this PRD. The specific message that surfaced the issue had raw JSON for `spine_entries` and raw enum keys for `monoparesisHalving`, `bladderBowelSeverity`, `discCordInvolvement`, and `spondylolysisPathway` — all of which already have correct clinical translations inside the confirmation builder. The registry approach avoids duplicating those translations and ensures future extractor comparison messages for any system automatically inherit correct labels.

The `formatValue` function in `extractorComparison.ts` already handles the ROM joints case correctly. That logic should be preserved verbatim inside the registry's lower-limb ROM formatter to avoid regression.

Once the registry exists, adding a new system to the `structured_live` pipeline will include adding its label registrations as part of the system's definition of done.
