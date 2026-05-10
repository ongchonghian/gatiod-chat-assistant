// Consensus orchestrator (ADR-0003 Slice F).
//
// Single entry point combining: pending-consensus resolution, the semantic
// gate, the semantic interpreter LLM call, and the proposal renderer.
//
// `chatServiceV2.ts` calls `runConsensusOrchestrator` between the
// pending-observation gate and grounding/route. The orchestrator returns
// a typed signal that tells chatServiceV2 what to do next:
//
//   • "respond"     — return this canned response to the user; pipeline stops
//   • "substitute"  — accepted consensus; continue extraction against
//                      `pendingConsensus.sourceText` (not the doctor's reply)
//   • "passthrough" — no consensus activity this turn; run the existing
//                      grounding/route/extract pipeline unchanged
//
// All behaviour changes are gated on TWO flags being on simultaneously:
//   - SEMANTIC_CONSENSUS_ENABLED     (gate activation)
//   - SEMANTIC_INTERPRETER_ENABLED   (LLM activation)
// When either is off, the orchestrator returns "passthrough" and existing
// tests are unaffected.

import { createHash, randomUUID } from "crypto";
import type {
  ConsensusResolutionAction,
  ExtractionContext,
  GatiodSystemKey,
  NormalizedUtterance,
  PendingConsensus,
  SemanticInterpretation,
  V2SessionState,
} from "./contracts.js";
import {
  setPendingConsensus,
  setClaimComponentOverride,
} from "./stateMachine.js";
import { tryResolvePendingConsensus } from "./consensusResolver.js";
import { shouldRunSemanticConsensus } from "./semanticConsensusGate.js";
import {
  runSemanticInterpreter,
  type SemanticInterpreterResult,
  type SemanticModelClient,
} from "./semanticInterpreter.js";
import { renderSemanticConsensus } from "./semanticInterpreterRenderer.js";

export interface ConsensusOrchestratorAuditEvent {
  eventType: string;
  payload: Record<string, unknown>;
}

export interface ConsensusOrchestratorRespondSignal {
  kind: "respond";
  state: V2SessionState;
  message: string;
  chips?: string[];
  needsClarification: boolean;
  policyReason: string;
  auditEvents: ConsensusOrchestratorAuditEvent[];
}

export interface ConsensusOrchestratorSubstituteSignal {
  kind: "substitute";
  state: V2SessionState;
  /** The original source text the doctor's accepted interpretation refers to.
   *  chatServiceV2 should re-normalize this and run the rest of the pipeline
   *  against it (instead of against the doctor's "Proceed" reply). */
  sourceText: string;
  /** Read-only context to thread into structured extractors via the 4th
   *  StructuredExtractor parameter (REQ-MS-EXTRACT-001). */
  extractionContext: ExtractionContext;
  auditEvents: ConsensusOrchestratorAuditEvent[];
}

export interface ConsensusOrchestratorPassthroughSignal {
  kind: "passthrough";
  /** No state mutation, no message; existing pipeline runs unchanged. */
  auditEvents: ConsensusOrchestratorAuditEvent[];
}

export type ConsensusOrchestratorResult =
  | ConsensusOrchestratorRespondSignal
  | ConsensusOrchestratorSubstituteSignal
  | ConsensusOrchestratorPassthroughSignal;

export interface ConsensusOrchestratorInput {
  state: V2SessionState;
  /** The doctor's raw reply this turn. */
  replyText: string;
  /** Pre-computed normalized utterance (chatServiceV2 normalizes before
   *  calling). */
  normalized: NormalizedUtterance;
  /** Optional model client; when omitted the orchestrator skips the
   *  interpreter and returns "passthrough". Tests inject a mock. */
  modelClient?: SemanticModelClient;
  /** Override env-var feature flags for testing. */
  forceConsensusEnabled?: boolean;
  forceInterpreterEnabled?: boolean;
}

function isConsensusFlagOn(force?: boolean): boolean {
  if (typeof force === "boolean") return force;
  const flag = process.env.SEMANTIC_CONSENSUS_ENABLED;
  return flag === "true" || flag === "1";
}

function isInterpreterFlagOn(force?: boolean): boolean {
  if (typeof force === "boolean") return force;
  const flag = process.env.SEMANTIC_INTERPRETER_ENABLED;
  return flag === "true" || flag === "1";
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function buildExtractionContext(
  pending: PendingConsensus,
  acceptedFindings: SemanticInterpretation["candidateFindings"] = [],
  focusSystem?: GatiodSystemKey,
): ExtractionContext {
  return {
    consensusId: pending.interpretationId,
    sourceText: pending.sourceText,
    sourceHash: pending.sourceHash,
    acceptedSystems: [...pending.candidateSystems],
    acceptedFindings,
    focusSystem,
  };
}

function passthrough(
  auditEvents: ConsensusOrchestratorAuditEvent[] = [],
): ConsensusOrchestratorPassthroughSignal {
  return { kind: "passthrough", auditEvents };
}

function buildPendingConsensusFromInterpretation(
  interpretation: SemanticInterpretation,
  rendered: { message: string },
): PendingConsensus {
  // interpretationHash is over the interpretation's content (excluding the
  // server-controlled fields the orchestrator may overwrite later).
  const hashInput = JSON.stringify({
    candidateSystems: interpretation.candidateSystems,
    candidateFindings: interpretation.candidateFindings,
    unsupportedTerms: interpretation.unsupportedTerms,
    assumptions: interpretation.assumptions,
  });
  return {
    interpretationId: interpretation.id,
    interpretationHash: sha256(hashInput),
    sourceHash: interpretation.sourceHash,
    sourceText: interpretation.sourceText,
    message: rendered.message,
    candidateSystems: interpretation.candidateSystems.map((s) => s.system),
    createdAt: interpretation.createdAt,
    awaiting: "decision",
  };
}

/**
 * Run the full Slice-F orchestration.
 *
 * Decision tree:
 *
 *   1. Either feature flag off → passthrough.
 *   2. state.pendingConsensus is set:
 *      a. awaiting === "edit_instruction" → take the entire reply as edit
 *         text, re-run the interpreter, replace pendingConsensus, render.
 *      b. otherwise → run `tryResolvePendingConsensus` and translate the
 *         action into the appropriate signal:
 *           - accepted_all / accepted_system_first → "substitute"
 *           - edit_requested  → "respond" (asks doctor for edit instruction)
 *           - rejected/legacy_requested/skipped_system → "respond"
 *           - unresolved → "respond" (re-renders consensus choices)
 *   3. No pendingConsensus and gate fires → invoke interpreter, persist
 *      pendingConsensus, "respond" with the proposal card.
 *   4. Gate does not fire → passthrough.
 */
export async function runConsensusOrchestrator(
  input: ConsensusOrchestratorInput,
): Promise<ConsensusOrchestratorResult> {
  const audits: ConsensusOrchestratorAuditEvent[] = [];

  // ── (1) Feature-flag gating ─────────────────────────────────────────────
  if (!isConsensusFlagOn(input.forceConsensusEnabled)) {
    return passthrough();
  }

  // ── (2) Pending consensus resolution ────────────────────────────────────
  const pending = input.state.pendingConsensus;
  if (pending) {
    // (2a) Edit-instruction mode: re-run interpreter with edit context.
    if (pending.awaiting === "edit_instruction") {
      if (!input.modelClient || !isInterpreterFlagOn(input.forceInterpreterEnabled)) {
        // Cannot re-run interpreter without the model. Fail-closed: keep
        // pendingConsensus and ask the doctor to choose another action.
        return {
          kind: "respond",
          state: input.state,
          message:
            "I cannot revise the interpretation right now. Please choose an action.",
          chips: ["Proceed", "Reject"],
          needsClarification: true,
          policyReason: "consensus_edit_unavailable",
          auditEvents: audits,
        };
      }
      const reInterp = await runSemanticInterpreter({
        client: input.modelClient,
        sourceText: pending.sourceText,
        previousInterpretationJson: JSON.stringify({
          interpretationId: pending.interpretationId,
          candidateSystems: pending.candidateSystems,
        }),
        doctorEditInstruction: input.replyText,
        forceEnabled: input.forceInterpreterEnabled,
      });
      audits.push(buildInterpreterAuditEvent(reInterp, pending.sourceText));
      if (!reInterp.ok) {
        return {
          kind: "respond",
          state: input.state,
          message:
            "I could not produce a revised interpretation. Please choose an action.",
          chips: ["Proceed", "Reject"],
          needsClarification: true,
          policyReason: "semantic_reinterpretation_failed",
          auditEvents: audits,
        };
      }
      const rendered = renderSemanticConsensus(reInterp.interpretation);
      const newPending = buildPendingConsensusFromInterpretation(
        reInterp.interpretation,
        rendered,
      );
      const nextState = setPendingConsensus(input.state, newPending);
      return {
        kind: "respond",
        state: nextState,
        message: rendered.message,
        chips: rendered.chips,
        needsClarification: true,
        policyReason: "semantic_reinterpretation_rendered",
        auditEvents: audits,
      };
    }

    // (2b) Decision mode: deterministic resolver.
    const resolution = tryResolvePendingConsensus({
      state: input.state,
      replyText: input.replyText,
    });
    if (resolution.auditEvent) {
      audits.push(resolution.auditEvent);
    }

    if (resolution.action === "accepted_all" || resolution.action === "accepted_system_first") {
      const focusSystem = pickFocusSystem(resolution.action, input.replyText, pending.candidateSystems);
      const extractionContext = buildExtractionContext(pending, [], focusSystem);
      return {
        kind: "substitute",
        state: resolution.state,
        sourceText: pending.sourceText,
        extractionContext,
        auditEvents: audits,
      };
    }

    // edit_requested (decision mode), rejected, legacy_requested,
    // skipped_system, unresolved — all return a response that stops the
    // pipeline. The resolver already populated state and (optionally) the
    // response message.
    return {
      kind: "respond",
      state: resolution.state,
      message:
        resolution.response?.message ??
        defaultMessageForAction(resolution.action),
      chips: resolution.response?.chips,
      needsClarification: resolution.response?.stopPipeline ?? true,
      policyReason: `consensus_${resolution.action}`,
      auditEvents: audits,
    };
  }

  // ── (3) No pendingConsensus: run the gate, possibly invoke interpreter. ─
  const gate = shouldRunSemanticConsensus({
    normalized: input.normalized,
    state: input.state,
    forceEnabled: input.forceConsensusEnabled,
  });

  if (!gate.shouldRun) {
    return passthrough();
  }

  if (!input.modelClient || !isInterpreterFlagOn(input.forceInterpreterEnabled)) {
    // Gate fired but interpreter is not available. Keep this branch as
    // passthrough so deterministic routing handles the input — no behaviour
    // regression. The audit log already recorded the gate decision.
    return passthrough();
  }

  const interp = await runSemanticInterpreter({
    client: input.modelClient,
    sourceText: input.replyText,
    forceEnabled: input.forceInterpreterEnabled,
  });
  audits.push(buildInterpreterAuditEvent(interp, input.replyText));

  if (!interp.ok) {
    // Interpreter failed validation. Fall back to deterministic pipeline.
    return passthrough(audits);
  }

  const rendered = renderSemanticConsensus(interp.interpretation);
  const newPending = buildPendingConsensusFromInterpretation(
    interp.interpretation,
    rendered,
  );
  const nextState = setPendingConsensus(input.state, newPending);

  return {
    kind: "respond",
    state: nextState,
    message: rendered.message,
    chips: rendered.chips,
    needsClarification: true,
    policyReason: "semantic_consensus_proposal",
    auditEvents: audits,
  };
}

function pickFocusSystem(
  action: ConsensusResolutionAction,
  replyText: string,
  candidateSystems: GatiodSystemKey[],
): GatiodSystemKey | undefined {
  if (action !== "accepted_system_first") return undefined;
  // Reuse the resolver's logic indirectly: the resolver already validated
  // the focus is in candidateSystems. Re-detect here for the extraction
  // context (the resolver doesn't currently expose focus on its result).
  const lower = replyText.toLowerCase();
  for (const sys of candidateSystems) {
    if (lower.includes(sys.replace(/_/g, " "))) return sys;
    if (sys === "lower_limb" && /\blower\s+limb\b/.test(lower)) return sys;
    if (sys === "upper_limb" && /\bupper\s+limb\b/.test(lower)) return sys;
    if (sys === "gastro_digestive" && /\bgastro\b/.test(lower)) return sys;
  }
  return undefined;
}

function defaultMessageForAction(action: ConsensusResolutionAction): string {
  switch (action) {
    case "rejected":
      return "Understood. Please provide the findings again, or choose the GATIOD system to assess.";
    case "edit_requested":
      return "What should I change in the interpretation?";
    case "legacy_requested":
      return "I will handle that system in legacy mode.";
    case "skipped_system":
      return "Skipped. Continuing with the remaining systems.";
    case "unresolved":
    default:
      return "Please choose how to proceed with the interpretation.";
  }
}

function buildInterpreterAuditEvent(
  result: SemanticInterpreterResult,
  sourceText: string,
): ConsensusOrchestratorAuditEvent {
  if (result.ok) {
    return {
      eventType: "semantic_interpretation_created",
      payload: {
        interpretationId: result.interpretation.id,
        sourceTextHash: sha256(sourceText),
        candidateSystems: result.interpretation.candidateSystems.map((s) => s.system),
        candidateFindingCount: result.interpretation.candidateFindings.length,
      },
    };
  }
  return {
    eventType:
      result.kind === "schema_validation_failed" ||
      result.kind === "safety_validation_failed"
        ? "semantic_interpretation_schema_failed"
        : "semantic_interpretation_schema_failed",
    payload: {
      kind: result.kind,
      message: result.message,
      schemaIssues: result.schemaIssues,
      safetyIssues: result.safetyIssues?.map((i) => ({ kind: i.kind, message: i.message })),
    },
  };
}

// Re-export for test convenience.
export { setClaimComponentOverride, randomUUID };
