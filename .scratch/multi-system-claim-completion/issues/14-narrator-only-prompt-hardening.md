# LLM narrator-only system prompt hardening

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

Adds an explicit "do not produce" constraint block to the chat layer's system prompt. The block enumerates the clinical fields and language patterns the LLM must never generate, complementing ADR D2 (no silent inference at extraction time) and ADR D10 (post-hoc regex guard) with a pre-hoc generation constraint.

Prohibited outputs:
- No PI% numbers in any framing ("Final PI%", "approximately 15%", "around 12%").
- No severity inferences ("mild", "moderate", "severe" as a label, unless the doctor stated it verbatim).
- No ASIA grade assignment (A/B/C/D).
- No diplopia zone classification.
- No ROM direction inference (must be stated or chip-selected).
- No nerve deficit type inference (sensory / motor / combined).
- No "system-generated GATIOD PI", "total PI", "overall PI" language anywhere.

The narrator role is positive-framed too: the LLM may *describe* the doctor's input back (acknowledgment, paraphrase), may *suggest* next questions, and may *draft* result narratives only after the deterministic renderer has produced the numbers.

The constraints are exported as a typed constant from the chat layer and concatenated into the system prompt at the existing system-prompt assembly point. A test asserts the constants appear in the assembled prompt verbatim, so accidental removal during a future prompt edit fails CI.

D10's regex guard remains the post-hoc catch — this slice is the pre-hoc constraint. Belt and braces.

## Acceptance criteria

- [ ] New exported constant `NARRATOR_ONLY_CONSTRAINTS` in the chat layer (e.g. `src/chat/promptConstraints.ts`) listing each prohibition.
- [ ] System prompt assembly concatenates the constraints into the final prompt.
- [ ] Unit test asserts each prohibition appears verbatim in the assembled prompt.
- [ ] Integration test: paste a narrative that previously elicited LLM-inferred PI% language → assistant response does not contain any PI% number, severity label, or ASIA grade.
- [ ] D10's regex guard remains in place and unchanged (covered by existing tests).

## Blocked by

None — can start immediately.
