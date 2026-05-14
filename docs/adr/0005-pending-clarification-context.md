---
id: ADR-0005
status: Proposed
sprint_sections:
  - Sprint 11
---

# Replace pendingClarification string with PendingClarificationContext

`V2SessionState.pendingClarification` was originally `string | null` — storing only the question text. This worked when only one system was ever active. With multi-system flows, the pending-observation gate in `chatServiceV2.ts` resolves doctor answers against whichever system comes first in `Object.entries()` insertion order, not the system that actually asked the question. This produces silent mis-routing: an answer intended for lower_limb can be consumed by upper_limb's open observation if both are in `collecting` simultaneously.

We replace the bare string with `PendingClarificationContext`:

```typescript
interface PendingClarificationContext {
  system: GatiodSystemKey;
  observationId: string;
  question: string;
  candidateAnswers: string[];
}
```

The `system` field makes the routing unambiguous — the gate reads `pendingClarification.system` directly, with no insertion-order scan.

## Considered options

**Keep the string and fix the insertion-order scan** — change `.find()` to track "last system to ask a question" via a separate `lastActiveSystem` field. Rejected: adds a second piece of mutable system-tracking state that can drift from the actual pending observation; `PendingClarificationContext` is authoritative by construction.

**Keep the string and add a parallel `pendingClarificationSystem` field** — rejected: two fields that must stay in sync are worse than one rich field.

## Consequences

- `coerceV2State()` must handle sessions where `pendingClarification` is an old string — coerce to `null` (safe: a string-only context cannot be re-routed correctly anyway).
- All writers of `pendingClarification` (policyEngine, chatServiceV2) must supply the full context object. The compiler enforces this after the type change.
- See REQ-H2 for acceptance criteria and file list.
