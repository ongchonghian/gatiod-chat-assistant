# Chat

The HTTP and conversation orchestration layer. Receives doctor messages, coordinates the legacy or V2 pipeline, manages session lifecycle, and returns structured responses. This context owns the entry point for all user-facing interactions but delegates clinical logic to the V2 pipeline and engine.

## Language

### Routes and services

**Legacy flow**:
The original chat path (`src/chat/chatService.ts`). Gemini proposes tool calls via function declarations; the service executes them and loops until a text response is produced. No structured extraction or readiness validation — the LLM drives everything.
_Avoid_: "V1", "old flow", "Gemini flow" (too ambiguous with V2, which also uses Gemini)

**V2 flow**:
The structured deterministic path (`src/chat/chatServiceV2.ts`). Normalization → pending-observation gate → optional semantic consensus → grounding → routing → extraction → readiness → confirmation → tool execution → rendering.
_Avoid_: "new flow", "structured flow"

**Chat route**:
The Express handler in `src/api/chatRoutes.ts`. Selects legacy or V2 flow based on the endpoint (`/api/chat` vs `/api/chat/v2`). Does not contain business logic.

### Prompt and LLM configuration

**System prompt**:
The static instruction set in `src/chat/systemPrompt.ts` passed to Gemini as `systemInstruction`. Defines the assistant's rules, response style, and tool usage strategy. Shared between legacy and V2 flows. Changes here affect every conversation immediately.
_Avoid_: "instructions", "prompt" (too vague)

**CHIPS suggestion**:
A suggested-response chip offered to the doctor at the end of an assistant message. In the legacy flow, extracted from special syntax in the Gemini response. In the V2 flow, produced deterministically by the renderer. Rendered as clickable buttons in the UI.
_Avoid_: "chip", "quick reply", "suggestion"

**Tool declaration**:
A Gemini function schema in `src/tools/toolSchemas.ts` declaring the name, description, and parameter structure of an assessment or lookup tool. Passed to Gemini as the `tools` argument. Distinct from the tool handler.

**Tool handler**:
The function in `src/tools/toolHandlers.ts` that executes a named tool call — validates args, calls the engine, and returns a `ToolResult`. Invoked by both legacy and V2 flows.

### Session and audit

**Session**:
A persisted conversation record keyed by `sessionId`. Contains message history (JSON), system states, and metadata. Stored in SQLite via `sessionStore.ts`.
_Avoid_: "conversation", "chat history"

**Audit event**:
A structured log entry emitted by `logAuditEvent()` capturing session lifecycle, normalization, routing, policy decisions, tool calls, and semantic consensus events. The primary traceability mechanism for medico-legal review.
_Avoid_: "log entry", "event"

**Session hydration**:
The process of loading an existing session from SQLite and coercing its stored JSON state through `coerceV2State()` to handle nullable fields added in newer pipeline versions.

### Error handling

**Retry strategy**:
Exponential backoff in the legacy flow for transient Gemini failures (rate limits, timeouts). `MAX_RETRIES` and `RETRY_DELAY_MS` control the behaviour. The V2 flow does not retry LLM calls — semantic interpreter failures surface as `V2FailureResponse`.

**Feature flag**:
An environment variable gate (e.g., `GATIOD_CHAT_ENABLED`, `SEMANTIC_INTERPRETER_ENABLED`) that controls whether a chat path or semantic feature is active. Checked at request time, not startup.
_Avoid_: "env var toggle", "config flag"

## Relationships

- **Chat route** → selects **legacy flow** or **V2 flow** based on endpoint.
- **Legacy flow** calls **tool handlers** directly after Gemini proposes them; **V2 flow** calls tool handlers only after the arg builder produces validated arguments.
- Both flows write **audit events** and persist **sessions**.
- **System prompt** and **tool declarations** are shared by both flows.
- **CHIPS suggestions** are produced by Gemini in the legacy flow; produced deterministically by the V2 renderer.

## Example dialogue

> **Dev:** "If the doctor sends a message to `/api/chat`, does it go through the V2 extractor?"
> **Domain expert:** "Not today — `/api/chat` routes to the **legacy flow**. `/api/chat/v2` routes to the **V2 flow**. The migration plan eventually makes V2 the default for `/api/chat`."

> **Dev:** "What's the difference between a tool declaration and a tool handler?"
> **Domain expert:** "A **tool declaration** is what we show Gemini — it tells the LLM a tool exists and what args it takes. A **tool handler** is the TypeScript function that actually runs when Gemini (or the arg builder) chooses that tool. One is a schema; the other is an execution."

## Flagged ambiguities

- "Gemini" — used loosely to refer to both the LLM model and the SDK client. When discussing flow, prefer "the legacy flow calls Gemini" (model) vs "the Gemini client" (SDK wrapper).
