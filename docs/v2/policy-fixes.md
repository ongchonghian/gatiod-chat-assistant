# V2 Slot Policy Fixes

Four confirmed bugs in the current V2 slot policy (`src/v2/slotEvaluator.ts`). All four are mismatches between what V2 asks the doctor and what the underlying engine accepts. Each fix is small, but the wrong wording produces wrong assessments — so these are correctness fixes, not cosmetic.

These are scheduled across sprints 4–6 alongside the corresponding system migrations. Each item below points to the live line in the current code.

---

## §1 — CNS Section B components

**File:** `src/v2/slotEvaluator.ts`
**Lines:** 129 (signal regex), 491–496 (slot policy)

**Current (wrong):**

```ts
// line 129
section_b_component: (t) =>
  /\b(bladder|bowel|sexual|spasms|pressure.?sore|component)\b/i.test(t),

// line 491–496
{
  key: "section_b_component",
  requiredWhen: "section_b_present AND component_missing",
  question: "Which Section B neurological component applies: bladder, bowel, sexual function, spasms, or pressure sores?",
  chips: ["No bladder/bowel", "Bladder", "Bowel", "Sexual function", "Spasms", "Pressure sores"],
}
```

**Why wrong:** Bladder/bowel/sexual/spasms/pressure sores are **spine** neurological complications (correctly used in spine slot policy at line 326). CNS Section B in the GATIOD schema covers olfaction, facial nerve, equilibrium, swallowing, station/gait, and respiration.

**Fix:**

```ts
// line 129
section_b_component: (t) =>
  /\b(olfact|facial(\s+nerve)?|equilibri|swallow|station|gait|respiration|breathing)\b/i.test(t),

// slot policy
{
  key: "section_b_component",
  requiredWhen: "section_b_present AND component_missing",
  question: "Which Section B neurological component applies: olfaction, facial nerve, equilibrium, swallowing, station/gait, or respiration?",
  chips: ["Olfaction", "Facial nerve", "Equilibrium", "Swallowing", "Station/gait", "Respiration"],
}
```

**Sprint:** 6 (V2-501).

**Validate against:** the CNS engine schema in `src/engine/cnsData.ts` to confirm exact component keys.

---

## §2 — Visual diplopia zones

**File:** `src/v2/slotEvaluator.ts`
**Lines:** 141–142 (signal regex), 536–540 (slot policy)

**Current (wrong):**

```ts
// line 141
diplopiaId: (t) =>
  /\b(diplopia|double.?vision|monocular|binocular|no.?diplopia)\b/i.test(t),

// line 536–540
{
  key: "diplopiaId",
  requiredWhen: "always",
  question: "Is there diplopia (double vision)? If yes, is it monocular or binocular?",
  chips: ["No diplopia", "Monocular", "Binocular"],
}
```

**Why wrong:** Engine accepts diplopia *zones*, not monocular/binocular. The clinical input is the angular range over which diplopia occurs.

**Fix:**

```ts
// line 141
diplopiaId: (t) =>
  /\b(diplopia|double.?vision|uncorrectable|central\s*30|30.?to.?60|beyond\s*60|no.?diplopia)\b/i.test(t),

// slot policy
{
  key: "diplopiaId",
  requiredWhen: "always",
  question: "Is there diplopia? If yes, is it uncorrectable, central 30°, 30–60°, or beyond 60°?",
  chips: ["No diplopia", "Uncorrectable", "Central 30°", "30–60°", "Beyond 60°"],
}
```

**Sprint:** 6 (V2-504).

**Validate against:** visual engine's diplopia enum to confirm exact zone keys.

---

## §3 — Gastro-digestive subsystem

**File:** `src/v2/slotEvaluator.ts`
**Lines:** 100 (signal regex), 405–411 (slot policy)

**Current (incomplete):**

```ts
// line 100
subSystem: (t) => /\b(colon|rectal|anal|liver|biliary|colonic|hepatic)\b/i.test(t),

// line 407–411
{
  key: "subSystem",
  requiredWhen: "always",
  question: "Which gastro-digestive subsystem applies: colonic/rectal/anal, or liver/biliary?",
  chips: ["Colon/rectum/anus", "Liver/biliary"],
}
```

**Why wrong:** Engine supports four subsystems. Current code only offers two — doctors cannot route upper GI (oesophagus, stomach, duodenum) or hernia cases.

**Fix:**

```ts
// line 100
subSystem: (t) => /\b(upper\s*gi|oesophag|esophag|stomach|duoden|colon|rectal|anal|liver|biliary|colonic|hepatic|hernia|herniation)\b/i.test(t),

// slot policy
{
  key: "subSystem",
  requiredWhen: "always",
  question: "Which gastro-digestive subsystem applies: upper GI, colon/rectum/anus, liver/biliary, or hernia?",
  chips: ["Upper GI", "Colon/rectum/anus", "Liver/biliary", "Hernia"],
}
```

**Sprint:** 5 (V2-401).

**Validate against:** `src/engine/gastroDigestiveData.ts` to confirm subsystem keys and any hernia-specific schema.

---

## §4 — Renal inputs (no eGFR)

**File:** `src/v2/slotEvaluator.ts`
**Lines:** 148–149 (signal regex), 372–377 (slot policy)

**Engine reference:** `src/engine/renalData.ts:117` — `RenalValueSchema`

```ts
RenalValueSchema = z.object({
  sex: z.enum(["male", "female"]),
  serumCreatinine: z.number().min(0).nullable(),
  creatinineClearance: z.number().min(0).nullable(),
  ckdStage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  clinicalSeverity: z.enum(["none", "continuous_surveillance", "incompletely_controlled", "persisting"]).nullable(),
  solitaryKidney: z.boolean(),
  provisionalAward: z.boolean(),
  selectedPi: z.number().nullable(),
});
```

**There is no `eGFR` field.** The engine accepts creatinine clearance (Cockcroft-Gault), not eGFR (CKD-EPI / MDRD). They are computed differently and using one in place of the other produces wrong PI%.

**Current (wrong):**

```ts
// line 148–149
renal_inputs: (t) =>
  /\b(creatinine|gfr|egfr|kidney.?function|renal.?function|\d+\s*µmol|\d+\s*umol|\d+\s*ml\/min)\b/i.test(t),

// line 374–377
{
  key: "renal_inputs",
  requiredWhen: "always",
  question: "Please provide the renal function values: serum creatinine (µmol/L) or eGFR (mL/min), and the sex if using creatinine-based scoring.",
  chips: ["Provide creatinine + sex", "Provide eGFR"],
}
```

**Fix:**

```ts
// line 148–149 (drop egfr, gfr aliases)
renal_inputs: (t) =>
  /\b(creatinine|creatinine.?clearance|ckd.?stage|clinical.?severity|kidney.?function|renal.?function|\d+\s*µmol|\d+\s*umol|\d+\s*ml\/min)\b/i.test(t),

// slot policy
{
  key: "renal_inputs",
  requiredWhen: "always",
  question: "Please provide any available renal inputs: serum creatinine, creatinine clearance, CKD stage, or clinical severity.",
  chips: ["Serum creatinine", "Creatinine clearance", "CKD stage", "Clinical severity"],
}
```

If the doctor types `"eGFR"` despite the question, the structured extractor (sprint 4) should treat it as ambiguous: ask whether the value was computed via CKD-EPI/MDRD (decline) or Cockcroft-Gault (accept as creatinine clearance).

**Sprint:** 4 (V2-303).

---

## Application order

These fixes ride alongside the corresponding system migration sprints:

| Sprint | Fix |
|---|---|
| 4 | §4 — Renal |
| 5 | §3 — Gastro-digestive |
| 6 | §1 — CNS Section B; §2 — Visual diplopia |

Do not apply these fixes to legacy slot policy in isolation. The fix lands as part of the new structured extractor for that system, so legacy and structured agree about what the slot signals mean.
