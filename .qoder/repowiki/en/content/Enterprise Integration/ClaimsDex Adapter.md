# ClaimsDex Adapter

<cite>
**Referenced Files in This Document**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [sessionStore.ts](file://src/db/sessionStore.ts)
- [dictionaryIndex.ts](file://src/rag/dictionaryIndex.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [chatServiceV2.ts](file://src/chat/chatServiceV2.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [database.ts](file://src/db/database.ts)
- [auditLog.ts](file://src/db/auditLog.ts)
- [server.ts](file://src/server.ts)
- [package.json](file://package.json)
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
This document explains the ClaimsDex adapter integration for the GATIOD chat assistant. It focuses on the clean interface design and pluggable architecture that enables seamless integration with the ClaimsDex platform. The adapter pattern cleanly separates concerns across four domains:
- Authentication
- Session database persistence
- Retrieval-Augmented Generation (RAG) search
- Medical report export

The goal is to provide healthcare IT integrators and developers with a clear understanding of how to replace the standalone implementations with ClaimsDex-native services while preserving a consistent interface contract.

## Project Structure
The adapter lives alongside the core chat service and integrates with the session store, RAG dictionary, and audit logging subsystems. The server exposes API endpoints that route to the chat services, which in turn rely on the adapter-configurable components.

```mermaid
graph TB
subgraph "Integration Layer"
CD["claimsDexAdapter.ts"]
end
subgraph "Chat Services"
CS["chatService.ts"]
CSV2["chatServiceV2.ts"]
CR["chatRoutes.ts"]
end
subgraph "Persistence"
SS["sessionStore.ts"]
DB["database.ts"]
AL["auditLog.ts"]
end
subgraph "RAG"
DI["dictionaryIndex.ts"]
end
subgraph "Server"
SRV["server.ts"]
end
CD --> CS
CD --> CSV2
CS --> SS
CSV2 --> SS
SS --> DB
CS --> AL
CSV2 --> AL
CS --> DI
CR --> CS
CR --> CSV2
SRV --> CR
```

**Diagram sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [chatServiceV2.ts](file://src/chat/chatServiceV2.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [sessionStore.ts](file://src/db/sessionStore.ts)
- [database.ts](file://src/db/database.ts)
- [auditLog.ts](file://src/db/auditLog.ts)
- [dictionaryIndex.ts](file://src/rag/dictionaryIndex.ts)
- [server.ts](file://src/server.ts)

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [server.ts](file://src/server.ts)

## Core Components
The adapter defines four clean interfaces and a configuration object enabling ClaimsDex to plug in platform-native services:

- AuthAdapter: Verifies incoming requests and returns an AuthUser or null.
- SessionDbAdapter: Persists and retrieves session state for chat continuity.
- RagAdapter: Provides dictionary and chapter search for RAG.
- MrExportAdapter: Generates a medical report from assessment results.

A standalone configuration is provided for local development, and ClaimsDex replaces these with platform services.

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)

## Architecture Overview
The adapter pattern isolates platform-specific logic behind stable interfaces. The chat services depend on these adapters rather than concrete implementations, enabling ClaimsDex to swap out components without changing the rest of the system.

```mermaid
classDiagram
class AuthAdapter {
+verifyRequest(headers) Promise~AuthUser|null~
}
class SessionDbAdapter {
+save(sessionId, data) Promise~void~
+load(sessionId) Promise~unknown|null~
+delete(sessionId) Promise~void~
}
class RagAdapter {
+searchDictionary(query) Promise~unknown[]~
+searchChapter(query, chapter) Promise~unknown[]~
}
class MrExportAdapter {
+generateReport(sessionId, results) Promise~ExportResult~
}
class IntegrationConfig {
+auth AuthAdapter
+mrExport MrExportAdapter
+featureFlagKey string
}
class AuthUser {
+userId string
+email string
+role string
}
class ExportResult {
+format "markdown"|"pdf"
+content string|Buffer
+filename string
}
AuthAdapter <|.. AuthUser
IntegrationConfig --> AuthAdapter
IntegrationConfig --> MrExportAdapter
```

**Diagram sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)

## Detailed Component Analysis

### Authentication Adapter (AuthAdapter)
Purpose:
- Authenticate incoming requests and return an AuthUser object or null.
- Standalone mode returns null (no auth).
- ClaimsDex mode expects a Firebase Auth-compatible implementation.

Interfaces and behaviors:
- Method signature: verifyRequest(headers) -> Promise<AuthUser | null>
- Expected behavior: Parse headers, validate credentials, and return user identity or null if unauthenticated.

Standalone implementation:
- Returns null for all requests in local mode.

Integration points:
- Used by the chat services to enforce access control and associate sessions with users.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Routes as "chatRoutes.ts"
participant Chat as "chatService.ts"
participant Auth as "AuthAdapter"
participant DB as "sessionStore.ts"
Client->>Routes : POST /api/chat
Routes->>Chat : processChat(sessionId, message, {userId, claimId})
Chat->>Auth : verifyRequest(headers)
Auth-->>Chat : AuthUser | null
Chat->>DB : saveSession(sessionId, history, {userId, claimId})
Chat-->>Routes : ChatResponse
Routes-->>Client : JSON response
```

**Diagram sources**
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [sessionStore.ts](file://src/db/sessionStore.ts)

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)

### Session Database Adapter (SessionDbAdapter)
Purpose:
- Persist and retrieve chat session state for continuity across restarts and resumes.
- Standalone mode uses SQLite; ClaimsDex uses shared PostgreSQL.

Interfaces and behaviors:
- save(sessionId, data) -> Promise<void>
- load(sessionId) -> Promise<unknown | null>
- delete(sessionId) -> Promise<void>

Standalone implementation:
- Uses SQLite via sessionStore.ts with a dedicated table for sessions and audit logs.

Integration points:
- Both chatService.ts and chatServiceV2.ts persist session state after each turn.
- Audit trail is recorded for medico-legal traceability.

```mermaid
flowchart TD
Start(["Session Operation"]) --> SaveLoad{"Save or Load?"}
SaveLoad --> |Save| SaveOp["Persist to SQLite"]
SaveLoad --> |Load| LoadOp["Retrieve from SQLite"]
SaveOp --> End(["Done"])
LoadOp --> End
```

**Diagram sources**
- [sessionStore.ts](file://src/db/sessionStore.ts)
- [database.ts](file://src/db/database.ts)
- [auditLog.ts](file://src/db/auditLog.ts)

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [sessionStore.ts](file://src/db/sessionStore.ts)
- [database.ts](file://src/db/database.ts)
- [auditLog.ts](file://src/db/auditLog.ts)

### RAG Search Adapter (RagAdapter)
Purpose:
- Provide dictionary and chapter-based search for grounding.
- Standalone mode uses a simple keyword search over the dictionary.
- ClaimsDex mode uses a hybrid retriever (BM25 + embeddings).

Interfaces and behaviors:
- searchDictionary(query) -> Promise<unknown[]>
- searchChapter(query, chapter?) -> Promise<unknown[]>

Standalone implementation:
- Loads the dictionary from knowledge/dictionary.json and performs substring matching.

Integration points:
- chatService.ts invokes searchDictionary during tool execution.
- chatServiceV2.ts uses a hybrid retriever for semantic grounding.

```mermaid
sequenceDiagram
participant Chat as "chatService.ts"
participant Tools as "toolHandlers.ts"
participant Rag as "RagAdapter"
participant Dict as "dictionaryIndex.ts"
Chat->>Tools : handleToolCall("search_dictionary", args)
Tools->>Rag : searchDictionary(query)
alt Standalone
Rag->>Dict : searchDictionary(query)
Dict-->>Rag : results[]
else ClaimsDex
Rag-->>Tools : results[]
end
Tools-->>Chat : ToolResult
```

**Diagram sources**
- [chatService.ts](file://src/chat/chatService.ts)
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [dictionaryIndex.ts](file://src/rag/dictionaryIndex.ts)

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [dictionaryIndex.ts](file://src/rag/dictionaryIndex.ts)
- [chatService.ts](file://src/chat/chatService.ts)

### Medical Report Export Adapter (MrExportAdapter)
Purpose:
- Generate a medical report from assessment results.
- Standalone mode exports a markdown file.
- ClaimsDex mode integrates with the DMR pipeline and TrustVC PDF generation.

Interfaces and behaviors:
- generateReport(sessionId, results) -> Promise<{ format, content, filename }>
- Expected output: format "markdown"|"pdf", content string|Buffer, filename string

Standalone implementation:
- Produces a markdown-formatted report with basic metadata and final PI percentage.

Integration points:
- Used by the UI and backend APIs to serve reports to users.

```mermaid
flowchart TD
Start(["Generate Report"]) --> Inputs["Collect Results"]
Inputs --> Format{"Format?"}
Format --> |Markdown| Markdown["Build Markdown Content"]
Format --> |PDF| Pdf["Build PDF Buffer"]
Markdown --> Output["Return ExportResult"]
Pdf --> Output
```

**Diagram sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)

### Adapter Registration and Configuration
The integration configuration binds adapters to the runtime:

- IntegrationConfig: Holds auth, mrExport, and featureFlagKey.
- standaloneConfig: Provides default adapters for local development.
- Feature flags: isGatiodChatEnabled() and environment variables control availability.

Practical example (conceptual):
- ClaimsDex builds a production-ready IntegrationConfig with:
  - AuthAdapter backed by Firebase Auth
  - SessionDbAdapter backed by shared PostgreSQL
  - RagAdapter backed by hybrid retriever
  - MrExportAdapter backed by DMR and TrustVC
- The server reads environment variables and routes requests to chat services, which consult the adapters.

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [server.ts](file://src/server.ts)

## Dependency Analysis
The adapter pattern reduces coupling between the chat services and platform-specific implementations. The following diagram shows key dependencies:

```mermaid
graph LR
Auth["AuthAdapter"] --> Chat["chatService.ts"]
Auth --> ChatV2["chatServiceV2.ts"]
Session["SessionDbAdapter"] --> Chat
Session --> ChatV2
Rag["RagAdapter"] --> Chat
Rag --> ChatV2
Export["MrExportAdapter"] --> Chat
Export --> ChatV2
Chat --> Routes["chatRoutes.ts"]
ChatV2 --> Routes
Routes --> Server["server.ts"]
Chat --> DB["sessionStore.ts"]
ChatV2 --> DB
DB --> SQLite["database.ts"]
Chat --> Audit["auditLog.ts"]
ChatV2 --> Audit
```

**Diagram sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [chatServiceV2.ts](file://src/chat/chatServiceV2.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [sessionStore.ts](file://src/db/sessionStore.ts)
- [database.ts](file://src/db/database.ts)
- [auditLog.ts](file://src/db/auditLog.ts)
- [server.ts](file://src/server.ts)

**Section sources**
- [claimsDexAdapter.ts](file://src/integration/claimsDexAdapter.ts)
- [chatService.ts](file://src/chat/chatService.ts)
- [chatServiceV2.ts](file://src/chat/chatServiceV2.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [sessionStore.ts](file://src/db/sessionStore.ts)
- [database.ts](file://src/db/database.ts)
- [auditLog.ts](file://src/db/auditLog.ts)
- [server.ts](file://src/server.ts)

## Performance Considerations
- Adapter boundaries: Keep adapter calls minimal and cacheable where appropriate.
- Session persistence: Use efficient SQL indexes and batch writes for audit logs.
- RAG search: Prefer ClaimsDex hybrid retriever for scalability and accuracy.
- Export throughput: Stream PDF generation and avoid large in-memory buffers.

## Troubleshooting Guide
Common issues and resolutions:
- Authentication failures: Verify header parsing and ClaimsDex auth middleware alignment.
- Session persistence errors: Check database connectivity and WAL mode settings.
- RAG search returns empty: Confirm dictionary availability and ClaimsDex hybrid retriever health.
- Report export fails: Validate DMR pipeline and TrustVC integration.

Operational checks:
- Environment variables: Ensure GEMINI_API_KEY and database path are set.
- Feature flags: Confirm GATIOD_CHAT_ENABLED and related toggles.
- Audit logs: Use getSessionAuditTrail to trace assessment events.

**Section sources**
- [chatService.ts](file://src/chat/chatService.ts)
- [auditLog.ts](file://src/db/auditLog.ts)
- [chatRoutes.ts](file://src/api/chatRoutes.ts)
- [server.ts](file://src/server.ts)
- [package.json](file://package.json)

## Conclusion
The ClaimsDex adapter integration leverages a clean, pluggable architecture to enable seamless platform integration. By adhering to the defined interfaces and configuration model, ClaimsDex can replace standalone implementations with production-grade services while maintaining a consistent developer experience and robust auditability.

## Appendices

### Adapter Interfaces Reference
- AuthAdapter.verifyRequest(headers): Promise<AuthUser | null>
- SessionDbAdapter.save(sessionId, data): Promise<void>
- SessionDbAdapter.load(sessionId): Promise<unknown | null>
- SessionDbAdapter.delete(sessionId): Promise<void>
- RagAdapter.searchDictionary(query): Promise<unknown[]>
- RagAdapter.searchChapter(query, chapter?): Promise<unknown[]>
- MrExportAdapter.generateReport(sessionId, results): Promise<{ format, content, filename }>

### Integration Scenarios
- Local development: Use standaloneAuth and standaloneMrExport with SQLite.
- ClaimsDex production: Replace adapters with platform-native services and configure feature flags accordingly.