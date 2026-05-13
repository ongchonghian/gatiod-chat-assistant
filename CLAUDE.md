# Project guidance for Claude Code

## V2 chat service migration

The V2 chat service is being migrated from a Gemini-driven flow to a deterministic, structured-fact-based assessment orchestrator. **Before working on anything in `src/v2/`, `src/chat/chatServiceV2.ts`, or related areas, read [docs/v2/README.md](docs/v2/README.md).**

The 12 binding architectural decisions in [docs/v2/architecture-decisions.md](docs/v2/architecture-decisions.md) are not optional. If you need to deviate, document the reason and update the decision record.

Sprint tickets (V2-001 onwards) are tracked in [docs/v2/sprints.md](docs/v2/sprints.md).

Known live bugs scheduled for fix during system migration: [docs/v2/policy-fixes.md](docs/v2/policy-fixes.md).

Open requirements not yet closed by a sprint ticket: [docs/v2/requirements-known-issues.md](docs/v2/requirements-known-issues.md).

## Keeping V2 docs in sync

[docs/v2/sprints.md](docs/v2/sprints.md) is the work-tracker of record. Every ADR, every `REQ-*` in [docs/v2/requirements-known-issues.md](docs/v2/requirements-known-issues.md), and every `structured_live` system in [src/v2/systemRegistry.ts](src/v2/systemRegistry.ts) must be reflected there.

Drift is caught by `npm run docs:verify`, which checks:

1. Every `docs/adr/*.md` with `status: Accepted | Proposed` has its ID referenced in `sprints.md` (via the `sprint_sections` frontmatter field).
2. Every `REQ-[A-Z]\d+` heading in `requirements-known-issues.md` is referenced at least once in `sprints.md`.
3. Every entry in `PROVISIONAL_STRUCTURED_LIVE` cites an open `REQ-*` that exists in `requirements-known-issues.md`.

Calibration freshness and ADR-0001 thresholds are enforced separately by `npm run check:adr-0001-promotion`.

**Run `npm run docs:verify` before committing changes to `docs/v2/`, `docs/adr/`, or `src/v2/systemRegistry.ts`.** CI runs the same check and blocks merge on drift.

When adding new artefacts:

- **New ADR** → add the frontmatter block (`id`, `status`, `sprint_sections`) at the top of the file, and add a sprint section to `sprints.md` that references the ADR ID. Once superseded, set `status: Superseded` and the verifier stops requiring sprint coverage.
- **New `REQ-*`** → add the heading to `requirements-known-issues.md` and a ticket to `sprints.md` that names the REQ ID.
- **New `structured_live` system** → run calibration, commit the `<system>.calibration.generated.json`, and add the system to `PROVISIONAL_STRUCTURED_LIVE` with a `REQ-*` that will retire the entry.

## Core invariants

These hold across the entire V2 codebase:

1. **`extractedFacts` contains only resolved, calculation-grade facts.** Unresolved data lives in `pendingObservations`.
2. **No silent inference of clinical fields.** ROM direction, deficit type, loss type, severity bracket, ASIA grade, diplopia zone, and final PI% must be stated by the doctor or selected from offered chips.
3. **`toolArgBuilder` reads only `extractedFacts`** and validates output via the engine's Zod schema (e.g. `UpperLimbValueSchema.safeParse`) before returning `ok: true`.
4. **Confirmation is a snapshot.** `V2SystemConfirmation.factsHash` must equal `hashExtractedFacts(currentFacts)` at execution time.
5. **No silent fallback to legacy after a confirmed V2 failure.** Failures are visible, audited, and require explicit doctor choice.
6. **`src/v2/systemRegistry.ts` is the only source of truth** for which systems are `structured_live`. `policyEngine.ts` and `chatServiceV2.ts` import from it.
7. **Final PI% language requires successful `assess_*` tool evidence.** Lookup responses may show table values but must not use final/system-generated PI wording.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context repo — four contexts (`engine`, `v2`, `chat`, `rag`) each with their own `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md` and `CONTEXT-MAP.md`.
