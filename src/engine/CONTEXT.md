# Engine

The pure-function calculation layer implementing GATIOD assessment rules. Each of the nine body systems is a self-contained module that accepts a validated input payload and returns a deterministic PI% result. This context owns no I/O, no LLM calls, and no session state.

## Language

### Clinical inputs

**ROM (Range of Motion)**:
A joint angle measurement in degrees. The primary input for limb and spine calculations. Always paired with a joint name and a movement direction — a bare angle without direction is not a valid engine input.
_Avoid_: "degrees of movement", "angle"

**AHL (Average Hearing Loss)**:
The average of pure-tone thresholds at 0.5, 1, 2, and 3 kHz for one ear, in decibels. Distinct from the raw audiogram (full frequency profile). The engine snaps values to the nearest 5 dB row.
_Avoid_: "hearing threshold", "audiogram result"

**DBE (Diagnosis-Based Estimate)**:
A fixed-value engine entry representing a named clinical condition (e.g., post-traumatic arthritis of the shoulder) that maps directly to a PI% without requiring ROM measurement. Conflicts with ROM entries in the same anatomical region.
_Avoid_: "diagnosis entry", "fixed impairment"

**Shortening**:
Lower limb length discrepancy in centimetres. A separate input category from ROM; scored via its own lookup table and combined via CVC.
_Avoid_: "limb length difference", "leg length discrepancy"

**Ankylosis**:
Complete joint fusion. Scored from a dedicated engine table distinct from the ROM measurement table. Mutually exclusive with ROM entries for the same joint.

### Severity and scoring

**Severity bracket**:
A predefined clinical severity level within a diagnosis category (e.g., "Grade I", "complete cord injury", ">50% height loss"). Maps to a base PI% or PI% range in the engine's lookup tables. Required input for spine, respiratory, and renal calculations.
_Avoid_: "severity level", "grade"

**ASIA grade**:
American Spinal Injury Association Impairment Scale classification (A = complete; B–D = incomplete; E = normal). Required for spinal cord injury entries in the spine module. Not used in any other system.

**Monoparesis**:
A modifier flag in the spine module that halves the base PI% when only one limb is affected by a spinal cord injury, as opposed to bilateral/full cord involvement.

**Presbycusis deduction**:
An age-related hearing loss reduction applied in the NID pathway. Subtracted from the base NID PI% at a fixed rate per year above age 50.

**First schedule**:
A 100% PI outcome. Triggers additional statutory benefits outside the engine's scope. The engine flags this result; the chat service surfaces it to the doctor.
_Avoid_: "100% case", "maximum impairment"

**Severity class**:
Used in respiratory and renal modules specifically. A discrete classification (e.g., Class 1, Class 2) derived from PFT metrics or renal function values. Determines the PI% range from which the doctor selects.

### Combination

**Intra-system CVC**:
CVC combination applied *within* a single system — e.g., combining ROM, neurological, and DBE categories for an upper limb result. Distinct from **Global CVC** (cross-system combination). Implemented in `cvcCalculator.ts`.

**Amputation suppression**:
Logic that disables scoring of anatomical structures distal to an amputation level (e.g., a below-elbow amputation suppresses hand and finger entries). Enforced at input validation time.

**Highest-award override**:
Spine-specific rule: when multiple diagnosis entries exist within a region, the engine selects the entry with the highest PI% rather than combining them.

## Relationships

- **ROM** and **DBE** entries for the same anatomical structure conflict — the engine applies a resolution rule (DBE wins or is suppressed depending on context).
- **Ankylosis** replaces **ROM** for a joint; both cannot be active simultaneously.
- **Amputation suppression** determines which **ROM** and **DBE** entries are evaluated.
- **Severity bracket** → **Severity class** (respiratory/renal) — bracket is the clinical label the doctor states; class is the engine's internal classification.
- **ASIA grade** determines eligibility for **Monoparesis** modifier in the spine module.

## Example dialogue

> **Dev:** "The spine entry has a severity key of `cord_injury_complete` — is that the same as ASIA grade A?"
> **Domain expert:** "Close but not the same. ASIA grade A is a clinical classification. `cord_injury_complete` is the engine's severity key — it implies ASIA A but is a separate field the extractor must populate from stated clinical findings, not inferred from the ASIA grade alone."

> **Dev:** "For hearing, do we average all audiogram frequencies?"
> **Domain expert:** "No — **AHL** is the average of 0.5, 1, 2, and 3 kHz only. Higher frequencies are excluded. The engine only sees the AHL value, not the raw audiogram."
