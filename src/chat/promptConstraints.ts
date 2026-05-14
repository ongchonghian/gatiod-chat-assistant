/**
 * Narrator-only constraints injected into the chat layer's system prompt.
 *
 * ADR-0007 § "LLM narrator-only system prompt hardening" / slice #14 — adds
 * a pre-hoc generation constraint to complement the existing post-hoc
 * guards (ADR D2 forbids silent inference at extraction time; ADR D10's
 * regex guard rejects assistant messages that claim a final PI%).
 *
 * The constraint set is exported as a typed constant so a unit test can
 * assert each prohibition appears verbatim in the assembled prompt — any
 * future edit that accidentally removes a rule fails CI.
 */

export const NARRATOR_ONLY_CONSTRAINTS: ReadonlyArray<string> = [
  "Never produce a final PI% number in any framing — no 'Final PI%: X%', no 'System-generated GATIOD PI%: X%', no 'total PI', no 'overall PI', no 'approximately X%'. Final percentages come from the deterministic assessment tools only.",
  "Never produce a severity label (mild / moderate / severe) unless the doctor stated it verbatim in their input.",
  "Never assign an ASIA grade (A / B / C / D) — this is a clinical decision the doctor must state explicitly.",
  "Never classify a diplopia zone (central 30° / 30–60° / beyond 60°) — present chips and let the doctor select.",
  "Never infer ROM direction (flexion / extension / abduction etc.) from a bare angle. Ask which direction explicitly.",
  "Never infer nerve deficit type (sensory / motor / combined) — the doctor must state it.",
  "Result narratives that include PI% values are written by the deterministic renderer, not by you. You may describe what the doctor told you and what fields are still missing; you may not announce final outcomes.",
];

/**
 * Assemble the constraints into a single block suitable for concatenation
 * into the main system prompt. Each constraint is a bullet line so the
 * pre-hoc rules sit alongside the existing prompt content without
 * disrupting markdown rendering.
 */
export function renderNarratorConstraintsBlock(): string {
  const lines = NARRATOR_ONLY_CONSTRAINTS.map((c) => `- ${c}`);
  return [
    "## Narrator-only constraints (ADR-0007 / slice #14)",
    "",
    "You are a narrator, not an authority on numbers. The following outputs are prohibited regardless of context:",
    "",
    ...lines,
  ].join("\n");
}
