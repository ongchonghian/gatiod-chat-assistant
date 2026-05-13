# Coverage Gap Analysis
**Source:** `gatiod_injury_scenario_catalogue_specific.xlsx` — "Specific Scenarios" sheet  
**Total scenarios analysed:** 2,419 (SPC-00001 → SPC-02419)  
**Test file:** `tests/engine/scenarioCatalogue.test.ts` (65 tests, all passing)  
**Last updated:** 2026-05-06 (re-run confirmed same gaps; GAP-07 scope expanded)

---

## Summary

| Status | Count | % | Notes |
|--------|-------|---|-------|
| ✅ Covered | 2,103 | 86.9% | Tool exists, fixed PI%, schema correct |
| ❌ No tool | 174 | 7.2% | OA (126), Instability (42), Tenosynovitis (6) |
| ⚠️ Schema bug | 80 | 3.3% | Tool exists but crashes or silently wrong |
| ⚠️ PI% range | 62 | 2.6% | Tool exists; LLM must ask doctor to select value first |
| **Total** | **2,419** | | |

### Covered methods (✅)
Amputation (125), Restricted motion (742), Ankylosis (694), Neurological disorder (134), Sensory loss of digits (60), Diagnosis-based estimate (201), Diagnosis-based spine estimate (56), Chronic pain syndrome (6), Add-on for spine neurological injury (4), Ligament / soft tissue injury (42), Shortening\*, Visual function\*, Traumatic or accident-related hearing loss (18), Noise-induced deafness (9), Medication-based classification (4), Dysarthria / dysphagia / hoarseness (3), Respiratory neurological impairment (3), Olfactory impairment (1), Optic nerve impairment (1)

\*Shortening and Visual function have tool schema bugs (see GAP-04, GAP-05).

---

## Gap Index

| Gap | Description | Scenarios | Priority | GH Issue |
|-----|-------------|-----------|----------|----------|
| GAP-01 | Post-traumatic OA — no tool | 126 | HIGH | [#8](https://github.com/ongchonghian/gatiod-chat-assistant/issues/8) |
| GAP-02 | Joint instability — no tool | 42 | HIGH | [#9](https://github.com/ongchonghian/gatiod-chat-assistant/issues/9) |
| GAP-03 | Constrictive tenosynovitis — no tool | 6 | MEDIUM | [#6](https://github.com/ongchonghian/gatiod-chat-assistant/issues/6) |
| GAP-04 | Visual tool schema mismatch (crashes) | 50 | CRITICAL | [#4](https://github.com/ongchonghian/gatiod-chat-assistant/issues/4) |
| GAP-05 | Shortening field name undocumented (silent wrong) | 30 | CRITICAL | [#4](https://github.com/ongchonghian/gatiod-chat-assistant/issues/4) |
| GAP-06 | Bilateral limb loss — no bilateral path | 8 | MEDIUM | [#7](https://github.com/ongchonghian/gatiod-chat-assistant/issues/7) |
| GAP-07 | PI% ranges — LLM must ask doctor (expanded scope) | ~62 | HIGH | [#5](https://github.com/ongchonghian/gatiod-chat-assistant/issues/5) |
| GAP-08 | Functional / Medication classification | 13 | LOW | [#5](https://github.com/ongchonghian/gatiod-chat-assistant/issues/5) |

---

## Detailed Gap Descriptions

### GAP-01 — Post-traumatic osteoarthritis (126 scenarios)
**Assessment method:** Post-traumatic osteoarthritis  
**Affected chapters:** Chapter 3 (upper limb), Chapter 4 (lower limb)  
**Example scenarios:** SPC-01792 to SPC-01917

**Problem:** GATIOD reports PI% as a **multi-value string per joint compartment**, not a single number.  
Examples of PI% values in the catalogue:
- Shoulder mild: `"4% 2% 2%"` (gleno-humeral / acromio-clavicular / sterno-clavicular)
- Shoulder moderate: `"8% 4% 4%"`
- Knee mild: `"4% 2%"` (knee / patellofemoral)
- Hip mild: `"6%"` (single joint)

**No tool exists** for OA assessment. Neither `assess_upper_limb` nor `assess_lower_limb` has a dedicated OA stream. Routing OA to the DBE stream is a workaround that only works for single-compartment joints.

**Extracted tables:** See [issue #8](https://github.com/ongchonghian/gatiod-chat-assistant/issues/8) for complete Chapter 3 and Chapter 4 OA tables.

**Recommendation:** Add OA conditions to `DBE_CONDITIONS` (upper limb) and a lookup table (lower limb). Each joint × severity = one fixed-value DBE condition. Multi-compartment joints run per-compartment then combine via `assess_global_cvc`.

---

### GAP-02 — Joint instability (42 scenarios)
**Assessment method:** Joint instability  
**Affected chapter:** Chapter 3 (upper limb)  
**Example scenarios:** SPC-01750 to SPC-01791

**Problem 1 — Non-numeric PI%:** Many instability scenarios report PI% as `"Persistent"`, `"Recurrent"`, or `"Persistent (untreated)"` — these are labels, not percentages. The actual PI% depends on the joint.

**Problem 2 — Multi-value PI%:** Many scenarios report PI% as multi-value strings matching joint compartments (e.g., `"10% - -"`, `"4% 2% 2%"`, `"- -"`). The dashes mean "not applicable" for that compartment.

**No tool exists** for joint instability assessment.

**Extracted table:** See [issue #9](https://github.com/ongchonghian/gatiod-chat-assistant/issues/9) for complete instability table (from Ch3 p.35).

**Recommendation:** Add a `lookup_joint_instability` tool with `joint` and `instabilityType` parameters.

---

### GAP-03 — Constrictive tenosynovitis (6 scenarios)
**Assessment method:** Constrictive tenosynovitis  
**Affected chapter:** Chapter 3 (upper limb)  
**Example scenarios:** SPC-01834 to SPC-01839

**PI values:** 1% (mild), 2% (moderate), 5% (severe)  
**Source:** GATIOD Ch3 Section D, p.36

**No tool exists.** Neither the DBE stream nor any lookup tool covers tenosynovitis.

**Recommendation:** Add 3 DBE conditions (`tenosynovitis_mild`, `tenosynovitis_moderate`, `tenosynovitis_severe`) to `DBE_CONDITIONS` in `src/engine/upperLimbData.ts`.

---

### GAP-04 — Visual tool schema mismatch (50 scenarios)
**Tool:** `assess_visual`  
**Affected chapter:** Chapter 11  
**Example scenarios:** SPC-02310 to SPC-02359

**Problem:** The `TOOL_DECLARATIONS` schema for `assess_visual` in `toolSchemas.ts` documents per-eye fields as:
- `fieldLossId` — but the engine's `EyeValue` interface expects `fieldId`
- `modifierIds` — but the engine expects `functionalModifiers`
- `conditionIds` — but the engine expects `specificConditions`

When the LLM follows the tool schema and passes `fieldLossId`, `modifierIds`, `conditionIds`, the engine receives `undefined` and throws:
```
TypeError: Cannot read properties of undefined (reading 'reduce')
```

**Fix:** Update `TOOL_DECLARATIONS` for `assess_visual` to use `fieldId`, `functionalModifiers`, `specificConditions`.

---

### GAP-05 — Lower limb shortening field name undocumented (30 scenarios)
**Tool:** `assess_lower_limb`  
**Affected chapter:** Chapter 4  
**Example scenarios:** SPC-01038 to SPC-01067

**Problem:** The `assess_lower_limb` schema describes `shortening` as an `OBJECT` but does not document its internal field name. The engine's `ShorteningValue` interface uses `discrepancyCm`. If the LLM guesses `cmDiscrepancy` or `cm` or any other name, it receives `undefined`, which maps to 30% (the maximum shortening bracket), corrupting all assessments.

**Observed failure:** Passing `{ cmDiscrepancy: 0 }` caused the engine to report 30% shortening instead of 0%, inflating every lower limb result by 8–30 percentage points via CVC.

**Fix:** Document `discrepancyCm` explicitly in the `assess_lower_limb` schema.

---

### GAP-06 — Bilateral upper/lower limb loss (8 scenarios)
**Tool:** `assess_upper_limb`, `assess_lower_limb`  
**Example scenarios:** SPC-00001 (both upper limbs, 100%), SPC-00002 (both hands, 100%), SPC-00066 (both legs, 100%)

**Problem:** Both tools require `side: "left" | "right"`. There is no bilateral path. `CVC(75%, 75%) = 94%`, not the GATIOD-specified 100%.

**Recommendation:** Add `bilateral: boolean` flag to both tool schemas + handler-level 100% cap in `toolHandlers.ts`.

---

### GAP-07 — PI% range scenarios: LLM must ask the doctor (~62 scenarios) ⚠️ SCOPE EXPANDED

**Updated finding (2026-05-06):** The PI% range gap is broader than initially documented. It affects 6 gastro methods and 6 CNS methods that were previously classified as "covered". 50 scenarios have explicit PI% range strings (e.g. `10-25%`); an additional ~12 have fixed values within range-based methods.

**All methods with PI% ranges:**

| Assessment method | Tool | Scenarios | Ranges |
|-------------------|------|-----------|--------|
| Upper digestive tract disease | assess_gastro | 4 | 0-9%, 10-24%, 25-49%, 50-75% |
| Colonic and rectal disorders | assess_gastro | 4 | 0-9%, 10-24%, 25-49%, 50-75% |
| Liver disease | assess_gastro | 4 | 0-14%, 15-29%, 30-49%, 50-95% |
| Biliary tract disease | assess_gastro | 4 | 0-14%, 15-29%, 30-49%, 50-95% |
| Anal disease | assess_gastro | 3 | 0-9%, 10-19%, 20-35% |
| Herniation | assess_gastro | 3 | 0-9%, 10-19%, 20-30% |
| Facial nerve / taste impairment | assess_cns | 3 | 1-4%, 5-19%, 20-45% |
| Mental status / integrative functioning | assess_cns | 4 | 5-10%, 11-99% (+ 2 fixed) |
| Dysphasia or aphasia | assess_cns | 3 | 10-25%, 26-99% (+ 1 fixed) |
| Emotional / behavioural disorder | assess_cns | 3 | 10-25%, 26-99% (+ 1 fixed) |
| Equilibrium impairment | assess_cns | 3 | 25-50%, 51-100% (+ 1 fixed) |
| Station and gait impairment | assess_cns | 3 | 25-50%, 51-99% (+ 1 fixed) |
| Impairment of consciousness | assess_cns | 4 | 5-25%, 26-99% (+ 2 at 100%) |
| Episodic loss of consciousness | assess_cns | 4 | 10-25%, 26-99% (+ 2 at 100%) |
| Sleep and arousal disorder | assess_cns | 4 | 10-25%, 26-99% (+ 2 at 100%) |
| Functional classification (respiratory) | assess_respiratory | 4 | 10-25%, 30-45%, 50-100% (+ 1 at 0%) |
| Functional classification (renal) | assess_renal | 5 | 0-10%, 11-30%, 31-60%, 61-100% (+ 1 fixed) |

**LLM behaviour:** Without the doctor's selected value, the LLM cannot fill `piPercent` or `selectedPi` correctly. It must use a conversational turn to elicit the doctor's judgment before calling the tool.

**Fix:** Add to the system prompt:

> "When a GATIOD condition has a PI% range (e.g., 5–25%), ask the doctor: 'Based on the clinical picture, which value within [range] best represents the degree of impairment?' Wait for their answer before calling the assessment tool."

This rule applies to: all gastro sub-systems, most CNS section B/D categories, CNS consciousness/episodic/sleep groups, respiratory functional classification, and renal functional classification.

---

### GAP-08 — Functional classification / Medication-based classification (13 scenarios)
**Assessment methods:** Functional classification, Medication-based classification  
**Affected chapters:** Chapter 6 (respiratory), Chapter 7 (renal)  
**Example scenarios:** SPC-02209 to SPC-02221

**Note:** The 9 functional classification scenarios are already counted in GAP-07 (they have ranges). The 4 medication-based scenarios (SPC-02213–02216) have **fixed** PI values and are correctly handled if the LLM knows to use the `asthmaMedication` parameter.

**Fix:** Document in the system prompt:
- Occupational asthma PI% is determined by `asthmaMedication` parameter: `bronchodilator_only=5%`, `low_dose_steroid=10%`, `high_dose_combo=15%`, `oral_steroid=20%`
- Renal PI% can use `ckdStage` (1–5) or lab values (`serumCreatinine`, `creatinineClearance`) interchangeably

---

## Tool Schema Corrections Required

### `assess_visual` (CRITICAL)
Update field names in `TOOL_DECLARATIONS` to match `EyeValue`:

| Schema (wrong) | Engine (correct) |
|----------------|------------------|
| `fieldLossId` | `fieldId` |
| `modifierIds` | `functionalModifiers` |
| `conditionIds` | `specificConditions` |

### `assess_lower_limb` (CRITICAL)
Document the `shortening` sub-field in the tool schema:
```
shortening.discrepancyCm — number, leg length discrepancy in cm (0–8 in 0.5 steps)
```

### `assess_upper_limb` (MEDIUM)
The `side` enum `["left", "right"]` should gain a `bilateral` flag for bilateral amputation cases (see GAP-06).

---

## LLM System Prompt Additions Required

1. **PI% ranges (all methods):** "When a GATIOD condition has a PI% range (e.g., 5–25%), ask the doctor: 'Based on the clinical picture, which value within [range] best represents the degree of impairment?' Wait for their answer before calling the assessment tool. This applies to: gastro sub-systems, CNS groups B and D, respiratory and renal functional classification."

2. **Bilateral limb loss:** "For bilateral limb loss (both arms/both hands/both legs/both feet), pass `bilateral: true` to `assess_upper_limb` or `assess_lower_limb`. The tool returns 100% automatically."

3. **Post-traumatic OA:** "For post-traumatic osteoarthritis, use DBE condition IDs `oa_<joint>_<severity>`. For multi-compartment joints (shoulder: GH + AC + SC; knee: knee + patellofemoral), run each compartment separately then combine via `assess_global_cvc`."

4. **Joint instability:** "For post-traumatic instability, use `lookup_joint_instability` with the joint key and instability type (`subluxation_persistent` / `dislocation_recurrent` / `dislocation_persistent_untreated`)."

5. **Constrictive tenosynovitis:** "Tenosynovitis uses DBE conditions: `tenosynovitis_mild` (1%), `tenosynovitis_moderate` (2%), `tenosynovitis_severe` (5%)."

6. **Occupational asthma:** "Occupational asthma PI% is set by `asthmaMedication` parameter: `bronchodilator_only`=5%, `low_dose_steroid`=10%, `high_dose_combo`=15%, `oral_steroid`=20%."
