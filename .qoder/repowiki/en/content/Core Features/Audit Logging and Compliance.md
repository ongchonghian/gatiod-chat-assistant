# Audit Logging and Compliance

<cite>
**Referenced Files in This Document**
- [auditLog.ts](file://src/db/auditLog.ts)
- [database.ts](file://src/db/database.ts)
- [sessionStore.ts](file://src/db/sessionStore.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [chatServiceV2.ts](file://src/chat/chatServiceV2.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [globalCvc.ts](file://src/v2/globalCvc.ts)
- [consensusOrchestrator.ts](file://src/v2/consensusOrchestrator.ts)
- [systemTraceAdapters.ts](file://src/v2/systemTraceAdapters.ts)
- [calculationTraceBuilder.ts](file://src/v2/calculationTraceBuilder.ts)
- [gatiod_holistic_prd.md](file://docs/gatiod_holistic_prd.md)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document explains the audit logging and compliance system that ensures complete interaction traceability and medico-legal compliance for the GATIOD chat assistant. The system captures every clinically relevant event across both the legacy and V2 pipelines, enabling full reconstruction of how a final PI% was determined. It documents the event logging model, data retention characteristics, and compliance reporting capabilities, with practical examples for both newcomers and experienced developers.

## Project Structure
The audit and compliance system spans several layers:
- Database layer with schema initialization and indexes
- Audit logger with a comprehensive event taxonomy
- Session store for persistent conversation state
- Chat services that emit audit events at key decision points
- API routes exposing audit trail retrieval and session management
- V2 consensus and extraction pipeline emitting granular audit events
- Global CVC orchestration with explicit audit events for offers and changes
- Calculation trace builders that generate deterministic, auditable traces

```mermaid
graph TB
subgraph "API Layer"
Routes["chatRoutes.ts"]
end
subgraph "Chat Services"
ChatV1["chatService.ts"]
ChatV2["chatServiceV2.ts"]
end
subgraph "Persistence"
DB["database.ts"]
Audit["auditLog.ts"]
Sessions["sessionStore.ts"]
end
subgraph "V2 Orchestration"
Consensus["consensusOrchestrator.ts"]
GCVC["globalCvc.ts"]
Traces["systemTraceAdapters.ts<br/>calculationTraceBuilder.ts"]
end
Routes --> ChatV1
Routes --> ChatV2
ChatV1 --> Audit
ChatV1 --> Sessions
ChatV2 --> Audit
ChatV2 --> Sessions
ChatV2 --> Consensus
ChatV2 --> GCVC
ChatV2 --> Traces
Audit --> DB
Sessions --> DB
```

**Diagram sources**
- [chatRoutes.ts:1-91](file://src/api/chatRoutes.ts#L1-L91)
- [chatService.ts:1-183](file://src/chat/chatService.ts#L1-L183)
- [chatServiceV2.ts:1-800](file://src/chat/chatServiceV2.ts#L1-L800)
- [auditLog.ts:1-91](file://src/db/auditLog.ts#L1-L91)
- [database.ts:1-57](file://src/db/database.ts#L1-L57)
- [sessionStore.ts:1-110](file://src/db/sessionStore.ts#L1-L110)
- [consensusOrchestrator.ts:1-200](file://src/v2/consensusOrchestrator.ts#L1-L200)
- [globalCvc.ts:1-361](file://src/v2/globalCvc.ts#L1-L361)
- [systemTraceAdapters.ts:309-555](file://src/v2/systemTraceAdapters.ts#L309-L555)
- [calculationTraceBuilder.ts:54-149](file://src/v2/calculationTraceBuilder.ts#L54-L149)

**Section sources**
- [chatRoutes.ts:1-91](file://src/api/chatRoutes.ts#L1-L91)
- [chatService.ts:1-183](file://src/chat/chatService.ts#L1-L183)
- [chatServiceV2.ts:1-800](file://src/chat/chatServiceV2.ts#L1-L800)
- [auditLog.ts:1-91](file://src/db/auditLog.ts#L1-L91)
- [database.ts:1-57](file://src/db/database.ts#L1-L57)
- [sessionStore.ts:1-110](file://src/db/sessionStore.ts#L1-L110)
- [consensusOrchestrator.ts:1-200](file://src/v2/consensusOrchestrator.ts#L1-L200)
- [globalCvc.ts:1-361](file://src/v2/globalCvc.ts#L1-L361)
- [systemTraceAdapters.ts:309-555](file://src/v2/systemTraceAdapters.ts#L309-L555)
- [calculationTraceBuilder.ts:54-149](file://src/v2/calculationTraceBuilder.ts#L54-L149)

## Core Components
- Audit logger: Defines the event taxonomy and persists entries with non-blocking writes.
- Database layer: Initializes tables and indexes, supports SQLite with WAL mode and JSON columns.
- Session store: Persists conversation history and system states, enabling resumable sessions.
- Chat services: Emit audit events for user interactions, tool calls, confirmations, and errors.
- V2 pipeline: Emits detailed events for normalization, routing, policy decisions, extractions, and consensus.
- Global CVC: Emits explicit events for offers, executions, exclusions, and staleness.
- Calculation traces: Produce deterministic, auditable calculation traces for each system.

**Section sources**
- [auditLog.ts:8-91](file://src/db/auditLog.ts#L8-L91)
- [database.ts:20-49](file://src/db/database.ts#L20-L49)
- [sessionStore.ts:10-109](file://src/db/sessionStore.ts#L10-L109)
- [chatService.ts:55-154](file://src/chat/chatService.ts#L55-L154)
- [chatServiceV2.ts:278-730](file://src/chat/chatServiceV2.ts#L278-L730)
- [globalCvc.ts:45-109](file://src/v2/globalCvc.ts#L45-L109)
- [systemTraceAdapters.ts:523-555](file://src/v2/systemTraceAdapters.ts#L523-L555)

## Architecture Overview
The audit and compliance architecture ensures that every decision and calculation is traceable:
- Events are logged immediately around critical actions (user input, tool execution, confirmation, policy decisions).
- The audit log is stored alongside session state for full replayability.
- V2 introduces granular events for semantic interpretation, extraction warnings, and multi-system extractions.
- Global CVC events explicitly track offers, exclusions, and staleness to prevent silent changes.
- Calculation traces are built deterministically and can be attached to audit records for full transparency.

```mermaid
sequenceDiagram
participant Client as "Client"
participant API as "chatRoutes.ts"
participant V1 as "chatService.ts"
participant V2 as "chatServiceV2.ts"
participant Audit as "auditLog.ts"
participant DB as "database.ts"
Client->>API : POST /chat or /chat/v2
API->>V1 : processChat(...) or processChatV2(...)
V1->>Audit : logAuditEvent(session_start/user_message)
V2->>Audit : logAuditEvent(v2_normalization/v2_route/v2_policy)
V2->>Audit : logAuditEvent(v2_extraction_warning/v2_multi_system_extraction)
V2->>Audit : logAuditEvent(v2_global_cvc_offered/executed/excluded/reenincluded)
V1->>Audit : logAuditEvent(tool_call/calculation_result/error)
Audit->>DB : INSERT INTO gatiod_audit_log
API-->>Client : Response with sessionId/message
```

**Diagram sources**
- [chatRoutes.ts:14-66](file://src/api/chatRoutes.ts#L14-L66)
- [chatService.ts:55-154](file://src/chat/chatService.ts#L55-L154)
- [chatServiceV2.ts:278-730](file://src/chat/chatServiceV2.ts#L278-L730)
- [auditLog.ts:58-90](file://src/db/auditLog.ts#L58-L90)
- [database.ts:35-45](file://src/db/database.ts#L35-L45)

## Detailed Component Analysis

### Audit Logger and Event Taxonomy
The audit logger defines a comprehensive event taxonomy covering:
- Session lifecycle: session_start, session_reset
- User interactions: user_message, assistant_message, error
- Tooling: tool_call, calculation_result
- V2 normalization and routing: v2_normalization, v2_route
- Policy decisions: v2_policy
- Extraction and confirmations: v2_extraction_warning, v2_multi_system_extraction, v2_pending_observation
- Consensus and semantic interpretation: v2_semantic_consensus_gate, semantic_interpretation_created, semantic_interpretation_accepted, semantic_interpretation_rejected, semantic_interpretation_edited
- Legacy fallback and deferred components: semantic_legacy_deferred_component, semantic_legacy_fallback_requested
- Global CVC: v2_global_cvc_offered, v2_global_cvc_executed, v2_global_cvc_component_excluded, v2_global_cvc_component_reincluded, v2_global_cvc_stale, v2_global_cvc_declined
- Specialized events: semantic_to_structured_extraction_started, semantic_to_structured_extraction_failed, semantic_multi_region_spine_detected, v2_component_skipped_by_user, spine_multi_region_unsupported

Implementation highlights:
- Non-blocking writes: failures are logged and do not crash the main flow.
- Centralized insertion and retrieval: consistent schema and indexing for fast queries.

Practical examples:
- A user message triggers a user_message event with message metadata.
- A tool call emits tool_call with success status; successful assessments emit calculation_result with tool result data.
- V2 normalization emits v2_normalization with confidence and unresolved terms.
- Multi-system extractions emit v2_multi_system_extraction with systems and route confidence.
- Global CVC offer emits v2_global_cvc_offered with component systems and values.

**Section sources**
- [auditLog.ts:8-91](file://src/db/auditLog.ts#L8-L91)
- [auditLog.ts:58-90](file://src/db/auditLog.ts#L58-L90)

### Database Schema and Indexing
The database layer initializes:
- gatiod_sessions table for conversation state and system states
- gatiod_audit_log table for audit events with indexes on session_id, event_type, and created_at

Key schema characteristics:
- JSON columns for flexible event payloads
- WAL mode for improved concurrency
- Indexes optimized for audit trail retrieval and session queries

Operational implications:
- Efficient audit trail retrieval by sessionId
- Fast filtering by event_type for compliance reporting
- Timestamp-based ordering for chronological reconstruction

**Section sources**
- [database.ts:20-49](file://src/db/database.ts#L20-L49)

### Session Store and State Persistence
The session store persists:
- Conversation history (structured content)
- System states for V2
- User and claim identifiers
- Status tracking (active/completed/abandoned)

Behavior:
- Upserts on save with updated_at timestamps
- Loads and deserializes JSON for history and system states
- Supports listing recent sessions for a user

Integration with audit:
- Session events (session_start, session_reset) are logged alongside state changes
- Audit trails can be correlated with session lifecycle

**Section sources**
- [sessionStore.ts:21-109](file://src/db/sessionStore.ts#L21-L109)

### Chat Service (Legacy Pipeline) Audit Events
The legacy chat service emits:
- session_start on first message of a session
- user_message for each incoming message
- assistant_message with tool call and chip counts
- tool_call for each function call with success status
- calculation_result for successful assess_* tool calls
- error for API failures
- session_reset on explicit reset

These events enable:
- End-to-end traceability from user input to tool execution
- Error attribution and recovery validation
- Deterministic calculation verification

**Section sources**
- [chatService.ts:55-154](file://src/chat/chatService.ts#L55-L154)

### Chat Service V2 Audit Events
The V2 pipeline emits granular events:
- v2_normalization with confidence and unresolved terms
- v2_pending_observation for pending observation resolution
- v2_route with operation, systems, confidence, and reasons
- v2_extraction_warning for extractor warnings
- v2_multi_system_extraction for multi-system extraction
- v2_policy with action, reason, and proposed tool count
- v2_shadow_result for shadow-mode evaluations
- v2_component_skipped_by_user for user-initiated skips
- semantic_* events for interpretation lifecycle
- Global CVC events: v2_global_cvc_offered, v2_global_cvc_executed, v2_global_cvc_component_excluded, v2_global_cvc_component_reincluded, v2_global_cvc_stale, v2_global_cvc_declined

These events support:
- Medico-legal traceability of semantic interpretation and deterministic extraction
- Compliance validation of multi-system assessments
- Transparent Global CVC offers and exclusions

**Section sources**
- [chatServiceV2.ts:278-730](file://src/chat/chatServiceV2.ts#L278-L730)

### Consensus Orchestrator Audit Events
The consensus orchestrator emits:
- v2_semantic_consensus_gate for gate decisions
- semantic_interpretation_created, semantic_interpretation_accepted, semantic_interpretation_rejected, semantic_interpretation_edited
- v2_semantic_router_comparison for comparison events

These events capture:
- The semantic proposal lifecycle
- Doctor’s acceptance or rejection of interpretations
- Routing comparisons and decisions

**Section sources**
- [consensusOrchestrator.ts:45-82](file://src/v2/consensusOrchestrator.ts#L45-L82)
- [consensusOrchestrator.ts:179-200](file://src/v2/consensusOrchestrator.ts#L179-L200)

### Global CVC Audit Events
Global CVC emits:
- v2_global_cvc_offered with component systems and values
- v2_global_cvc_executed with final result and trace
- v2_global_cvc_component_excluded with reason and previous snapshot
- v2_global_cvc_component_reincluded with previous snapshot
- v2_global_cvc_stale when eligibility changes
- v2_global_cvc_declined when the doctor declines

These events ensure:
- Explicit audit trail for Global CVC decisions
- Stale detection and re-offering guarantees
- Transparent exclusion and re-inclusion logic

**Section sources**
- [globalCvc.ts:45-109](file://src/v2/globalCvc.ts#L45-L109)
- [globalCvc.ts:298-360](file://src/v2/globalCvc.ts#L298-L360)
- [gatiod_holistic_prd.md:902-912](file://docs/gatiod_holistic_prd.md#L902-L912)

### Calculation Traces and Deterministic Evidence
Calculation traces:
- Build deterministic, auditable traces per system
- Split inputs into included and excluded with reasons
- Apply caps and produce final values
- Include step-by-step reasoning and rule notes

Integration with audit:
- Traces can be attached to audit records for full calculation transparency
- System-specific adapters produce structured trace data

**Section sources**
- [systemTraceAdapters.ts:523-555](file://src/v2/systemTraceAdapters.ts#L523-L555)
- [calculationTraceBuilder.ts:54-149](file://src/v2/calculationTraceBuilder.ts#L54-L149)

### API Exposure for Audit and Compliance
The API exposes:
- GET /chat/audit/:sessionId to retrieve the full audit trail for a session
- GET /chat/sessions/:userId to list recent sessions for resumption
- POST /chat/reset to clear a session and emit session_reset

These endpoints support:
- Compliance reporting and external audit queries
- Session resumption and continuity
- Clean reset for sensitive sessions

**Section sources**
- [chatRoutes.ts:76-90](file://src/api/chatRoutes.ts#L76-L90)

## Dependency Analysis
The audit and compliance system exhibits strong cohesion within the persistence and logging layers, with clear separation of concerns:
- chatService.ts depends on auditLog.ts and sessionStore.ts
- chatServiceV2.ts depends on auditLog.ts, sessionStore.ts, consensusOrchestrator.ts, and globalCvc.ts
- auditLog.ts depends on database.ts
- sessionStore.ts depends on database.ts
- API routes depend on chat services and audit log

```mermaid
graph LR
ChatV1["chatService.ts"] --> Audit["auditLog.ts"]
ChatV1 --> Sessions["sessionStore.ts"]
ChatV2["chatServiceV2.ts"] --> Audit
ChatV2 --> Sessions
ChatV2 --> Consensus["consensusOrchestrator.ts"]
ChatV2 --> GCVC["globalCvc.ts"]
Audit --> DB["database.ts"]
Sessions --> DB
Routes["chatRoutes.ts"] --> ChatV1
Routes --> ChatV2
```

**Diagram sources**
- [chatService.ts:16-17](file://src/chat/chatService.ts#L16-L17)
- [chatServiceV2.ts:1-6](file://src/chat/chatServiceV2.ts#L1-L6)
- [auditLog.ts:6](file://src/db/auditLog.ts#L6)
- [sessionStore.ts:8](file://src/db/sessionStore.ts#L8)
- [chatRoutes.ts:7-10](file://src/api/chatRoutes.ts#L7-L10)

**Section sources**
- [chatService.ts:16-17](file://src/chat/chatService.ts#L16-L17)
- [chatServiceV2.ts:1-6](file://src/chat/chatServiceV2.ts#L1-L6)
- [auditLog.ts:6](file://src/db/auditLog.ts#L6)
- [sessionStore.ts:8](file://src/db/sessionStore.ts#L8)
- [chatRoutes.ts:7-10](file://src/api/chatRoutes.ts#L7-L10)

## Performance Considerations
- Non-blocking audit writes: audit logging failures do not impact main flow latency.
- SQLite WAL mode: improves concurrent reads/writes for audit and session queries.
- Indexed audit columns: efficient filtering and sorting for compliance reports.
- JSON column usage: flexible payloads without schema churn.
- Shadow-mode evaluation: v2 shadow mode runs alongside production without affecting latency.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Audit event not recorded: verify non-blocking write behavior and check console for "[Audit] Failed to log event".
- Missing audit trail: ensure sessionId is preserved and passed to getSessionAuditTrail.
- Session reset confusion: confirm session_reset event is emitted and session status updated to abandoned.
- V2 extraction warnings: review v2_extraction_warning payloads for actionable remediation.
- Global CVC staleness: verify snapshot verification and re-offer logic.

**Section sources**
- [auditLog.ts:69-72](file://src/db/auditLog.ts#L69-L72)
- [chatService.ts:179-182](file://src/chat/chatService.ts#L179-L182)
- [chatServiceV2.ts:590-611](file://src/chat/chatServiceV2.ts#L590-L611)
- [globalCvc.ts:126-158](file://src/v2/globalCvc.ts#L126-L158)

## Conclusion
The audit logging and compliance system provides complete, deterministic traceability for every PI% calculation. By capturing events across both legacy and V2 pipelines, maintaining persistent sessions, and emitting granular audit events for semantic interpretation, extraction, and Global CVC decisions, the system meets medico-legal requirements while enabling robust compliance reporting and validation.

## Appendices

### Compliance Reporting Workflow
- Retrieve audit trail by sessionId using GET /chat/audit/:sessionId.
- Filter events by type for policy decisions, confirmations, and tool executions.
- Cross-reference with session history for contextual reconstruction.
- Export traces and calculation details for regulatory submissions.

**Section sources**
- [chatRoutes.ts:76-81](file://src/api/chatRoutes.ts#L76-L81)
- [auditLog.ts:75-90](file://src/db/auditLog.ts#L75-L90)

### Practical Examples
- Audit event capture: user_message, tool_call, calculation_result, v2_normalization, v2_extraction_warning, v2_global_cvc_offered.
- Trail generation: chronological retrieval ordered by created_at for full replay.
- Compliance validation: verify that every PI% has a corresponding calculation_result and confirmation events; ensure Global CVC exclusions are audited with component_excluded/reenincluded events.

**Section sources**
- [chatService.ts:55-154](file://src/chat/chatService.ts#L55-L154)
- [chatServiceV2.ts:278-730](file://src/chat/chatServiceV2.ts#L278-L730)
- [globalCvc.ts:298-360](file://src/v2/globalCvc.ts#L298-L360)