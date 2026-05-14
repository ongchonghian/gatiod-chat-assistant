# ADR-0006, ADR-0007, and CONTEXT.md additions for claim submission and meta-intents

Status: done
Type: HITL

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

Two new ADRs and three CONTEXT.md additions that record the architectural decisions underpinning the multi-system claim completion work. These need to land before any implementation slice so that downstream PRs have a stable architectural record to reference.

**ADR-0006: Claim submission as a first-class state transition.** Captures the trade-off space considered during planning — strict completion vs. pragmatic vs. doctor-affirmed — and records why the doctor-affirmed approach was chosen. Documents the new `claim_submitted` state, `V2SessionState.claimSubmittedAt` field, `RouteOperation = "finalise_claim"` variant, and the single-event audit semantics. Lives in `docs/adr/` (system-wide ADR).

**ADR-0007: Meta-intents as a deterministic, LLM-free routing class.** Captures the trade-off between deterministic regex, chip-only, and LLM-classify approaches. Records the choice of regex+chips, the rejection of LLM-classify, and the fall-through-on-miss semantics. Defines the `MetaIntent` discriminated union and the `RouteOperation = "meta"` variant. Lives in `docs/adr/` (system-wide ADR).

**CONTEXT.md additions.** Root `CONTEXT.md` adds "Submit event" / "claim submission" / "claim_submitted" as domain terms. `src/v2/CONTEXT.md` adds "Meta intent" / "Meta routing" under Pipeline gates, and "Claim plan sub-header" as a UI primitive paragraph under Pipeline gates noting it visualises the proactive system queue.

Both ADRs include their frontmatter blocks (`id`, `status: Proposed`, `sprint_sections`) so that `npm run docs:verify` passes. A sprint section in `docs/v2/sprints.md` is added that references each ADR ID.

## Acceptance criteria

- [ ] `docs/adr/0006-claim-submission-state-transition.md` exists with frontmatter, problem statement, decision, rationale, and consequences.
- [ ] `docs/adr/0007-meta-intents-deterministic-routing.md` exists with frontmatter, problem statement, decision, rationale, and consequences.
- [ ] Root `CONTEXT.md` includes new domain terms for Submit event, claim submission, and `claim_submitted`.
- [ ] `src/v2/CONTEXT.md` includes Meta intent, Meta routing, and Claim plan sub-header entries under Pipeline gates.
- [ ] `docs/v2/sprints.md` references both ADR IDs in a new sprint section.
- [ ] `npm run docs:verify` passes after the changes.

## Blocked by

None — can start immediately.
