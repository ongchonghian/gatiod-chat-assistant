# Testing Strategy

<cite>
**Referenced Files in This Document**
- [vitest.config.ts](file://vitest.config.ts)
- [setup.ts](file://tests/setup.ts)
- [README.md](file://README.md)
- [ci.yml](file://.github/workflows/ci.yml)
- [package.json](file://package.json)
- [upperLimb.test.ts](file://tests/engine/upperLimb.test.ts)
- [policyEngine.test.ts](file://tests/v2/policyEngine.test.ts)
- [p1A.shadowRunner.test.ts](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts)
- [p1A.semanticShadowGrader.test.ts](file://tests/v2/p1A.semanticShadowGrader.test.ts)
- [p1B2.auditPayloadExpansion.test.ts](file://tests/v2/p1B2.auditPayloadExpansion.test.ts)
- [p1B.cvcExclusion.test.ts](file://tests/v2/p1B.cvcExclusion.test.ts)
- [loadFixture.ts](file://tests/v2/excelScenarios/loadFixture.ts)
- [scenarioTypes.ts](file://tests/v2/excelScenarios/scenarioTypes.ts)
- [runSystemShadowSample.ts](file://tests/v2/excelScenarios/runSystemShadowSample.ts)
- [gradeShadowOutcome.ts](file://tests/v2/excelScenarios/gradeShadowOutcome.ts)
- [crossSystem.shadow.test.ts](file://tests/v2/excelScenarios/crossSystem.shadow.test.ts)
- [upperLimb.readinessAndArgBuilder.test.ts](file://tests/v2/upperLimb/readinessAndArgBuilder.test.ts)
- [auditLog.ts](file://src/db/auditLog.ts)
- [chatServiceV2.ts](file://src/chat/chatServiceV2.ts)
- [0001-structured-live-promotion-gate.md](file://docs/adr/0001-structured-live-promotion-gate.md)
</cite>

## Update Summary
**Changes Made**
- Enhanced environment variable management section with improved testing infrastructure
- Added comprehensive audit payload validation tests documentation
- Updated CI workflow to reflect new testing command structure
- Expanded testing architecture to include audit event validation
- Added new audit payload expansion and CVC exclusion test coverage

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
This document defines the comprehensive testing strategy for the GATIOD Chat Assistant. It covers unit testing with Vitest, engine calculation validation, V2 pipeline testing, and integration testing methodologies. It documents the testing architecture, setup, mocks, and assertion patterns; provides examples of engine and policy validations; outlines semantic shadow testing; and establishes guidelines for writing new tests, managing test data, continuous integration, performance and regression testing, quality assurance, debugging, coverage, and best practices tailored for healthcare applications.

**Updated** Enhanced with improved environment variable management infrastructure and comprehensive audit payload validation capabilities.

## Project Structure
The testing surface spans:
- Engine calculation tests under tests/engine
- V2 pipeline tests under tests/v2
- Scenario fixtures and shadow runners under tests/v2/excelScenarios
- Setup and configuration under vitest.config.ts and tests/setup.ts
- CI gates under .github/workflows/ci.yml
- Audit event validation tests under tests/v2/p1B2.auditPayloadExpansion.test.ts and tests/v2/p1B.cvcExclusion.test.ts

```mermaid
graph TB
A["Vitest Config<br/>vitest.config.ts"] --> B["Test Setup<br/>tests/setup.ts"]
B --> C["Engine Tests<br/>tests/engine/upperLimb.test.ts"]
B --> D["V2 Policy Engine Tests<br/>tests/v2/policyEngine.test.ts"]
B --> E["P1-A Semantic Shadow Runner<br/>tests/v2/semanticShadow/p1A.shadowRunner.test.ts"]
B --> F["P1-A Semantic Grader Unit Tests<br/>tests/v2/p1A.semanticShadowGrader.test.ts"]
B --> G["Excel Shadow Helpers<br/>tests/v2/excelScenarios/*.ts"]
B --> H["Audit Payload Expansion Tests<br/>tests/v2/p1B2.auditPayloadExpansion.test.ts"]
B --> I["CVC Exclusion Tests<br/>tests/v2/p1B.cvcExclusion.test.ts"]
G --> J["Fixture Loader<br/>tests/v2/excelScenarios/loadFixture.ts"]
G --> K["Scenario Types<br/>tests/v2/excelScenarios/scenarioTypes.ts"]
G --> L["Runner & Grader<br/>tests/v2/excelScenarios/runSystemShadowSample.ts"]
G --> M["Outcome Grading<br/>tests/v2/excelScenarios/gradeShadowOutcome.ts"]
G --> N["Cross-System Shadow<br/>tests/v2/excelScenarios/crossSystem.shadow.test.ts"]
O["CI Workflow<br/>.github/workflows/ci.yml"] --> P["Default Suite"]
O --> Q["Excel Fixture Freshness"]
O --> R["Excel Shadow Suite"]
O --> S["ADR-0001 Promotion Check"]
```

**Diagram sources**
- [vitest.config.ts:1-12](file://vitest.config.ts#L1-L12)
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)
- [upperLimb.test.ts:1-156](file://tests/engine/upperLimb.test.ts#L1-L156)
- [policyEngine.test.ts:1-123](file://tests/v2/policyEngine.test.ts#L1-L123)
- [p1A.shadowRunner.test.ts:1-94](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L1-L94)
- [p1A.semanticShadowGrader.test.ts:1-323](file://tests/v2/p1A.semanticShadowGrader.test.ts#L1-L323)
- [p1B2.auditPayloadExpansion.test.ts:1-241](file://tests/v2/p1B2.auditPayloadExpansion.test.ts#L1-L241)
- [p1B.cvcExclusion.test.ts:1-199](file://tests/v2/p1B.cvcExclusion.test.ts#L1-L199)
- [loadFixture.ts:1-50](file://tests/v2/excelScenarios/loadFixture.ts#L1-L50)
- [scenarioTypes.ts:1-97](file://tests/v2/excelScenarios/scenarioTypes.ts#L1-L97)
- [runSystemShadowSample.ts:1-187](file://tests/v2/excelScenarios/runSystemShadowSample.ts#L1-L187)
- [gradeShadowOutcome.ts:1-180](file://tests/v2/excelScenarios/gradeShadowOutcome.ts#L1-L180)
- [crossSystem.shadow.test.ts:1-267](file://tests/v2/excelScenarios/crossSystem.shadow.test.ts#L1-L267)
- [ci.yml:1-60](file://.github/workflows/ci.yml#L1-L60)

**Section sources**
- [README.md:70-77](file://README.md#L70-L77)
- [vitest.config.ts:1-12](file://vitest.config.ts#L1-L12)
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)

## Core Components
- Vitest configuration and setup:
  - Includes all tests under tests/**/*.test.ts and loads environment once via setup.ts.
  - Enables opt-in suites (e.g., semantic shadow) via environment flags.
  - **Enhanced**: Improved environment variable management with centralized dotenv loading.
- Engine calculation tests:
  - Validate pure calculation logic for upper limb (ROM lookup, amputation, combined values, final percent).
- V2 policy engine tests:
  - Validate routing decisions, grounding effects, and session-state-aware behavior.
- Semantic shadow runner:
  - Optional integration-grade test that evaluates the real semantic interpreter against curated goldens.
- Excel shadow runner:
  - End-to-end scenario-driven testing against the canonical workbook, with per-system and cross-system grading.
- **New**: Audit payload validation tests:
  - Comprehensive validation of audit event payloads including privacy-preserving source text handling.
  - Global CVC exclusion and re-inclusion audit event testing.
- Grading and reporting:
  - Outcome classification, safe-outcome and exact-calculation rates, and calibration reports.

**Updated** Enhanced environment variable management and added comprehensive audit payload validation capabilities.

**Section sources**
- [vitest.config.ts:1-12](file://vitest.config.ts#L1-L12)
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)
- [upperLimb.test.ts:14-156](file://tests/engine/upperLimb.test.ts#L14-L156)
- [policyEngine.test.ts:20-123](file://tests/v2/policyEngine.test.ts#L20-L123)
- [p1A.shadowRunner.test.ts:10-94](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L10-L94)
- [p1B2.auditPayloadExpansion.test.ts:8-241](file://tests/v2/p1B2.auditPayloadExpansion.test.ts#L8-L241)
- [p1B.cvcExclusion.test.ts:11-199](file://tests/v2/p1B.cvcExclusion.test.ts#L11-L199)
- [crossSystem.shadow.test.ts:139-267](file://tests/v2/excelScenarios/crossSystem.shadow.test.ts#L139-L267)

## Architecture Overview
The testing architecture separates concerns into:
- Pure unit tests for deterministic calculations and policy logic
- Shadow runners for realistic, scenario-driven validation
- CI gates enforcing reproducibility and promotion criteria
- **Enhanced**: Centralized environment variable management for consistent test execution
- **New**: Comprehensive audit event validation and privacy-preserving data handling

```mermaid
sequenceDiagram
participant Dev as "Developer"
participant VT as "Vitest Runner"
participant Setup as "Setup (dotenv)"
participant EnvMgr as "Environment Manager"
participant Unit as "Unit Tests"
participant Shadow as "Shadow Suites"
participant Audit as "Audit Validation"
participant CI as "CI Workflow"
Dev->>VT : npm test
VT->>Setup : Load env once
Setup->>EnvMgr : Initialize environment variables
EnvMgr-->>VT : Environment ready
VT->>Unit : Run default unit tests
VT->>Shadow : Optionally run shadow suites (flags)
Shadow->>Audit : Validate audit events
Audit-->>Shadow : Audit results
Shadow-->>VT : Results and reports
VT-->>Dev : Test summary
CI->>VT : Default suite (no shadow)
CI->>VT : Excel fixture freshness
CI->>VT : Excel shadow suite (with thresholds)
CI->>VT : Promotion check (ADR-0001)
```

**Diagram sources**
- [vitest.config.ts:3-11](file://vitest.config.ts#L3-L11)
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)
- [ci.yml:26-60](file://.github/workflows/ci.yml#L26-L60)

## Detailed Component Analysis

### Enhanced Environment Variable Management
**New Section** Purpose:
- Centralized environment variable loading for consistent test execution across all test suites.
- Eliminates redundant dotenv configuration calls within individual tests.
- Supports opt-in test suites that require external API credentials.

Key improvements:
- Single dotenv.load() call in setup.ts ensures all environment variables are available globally.
- Opt-in test suites (semantic shadow, Excel scenarios) can access API keys without manual configuration.
- CI environment remains unaffected, maintaining security and separation of concerns.

```mermaid
flowchart TD
Start(["Test Execution Start"]) --> VT["Vitest Runner"]
VT --> Setup["setup.ts executes"]
Setup --> Dotenv["dotenv.config() called once"]
Dotenv --> EnvReady["Environment Variables Loaded"]
EnvReady --> TestSuite["Test Suite Execution"]
TestSuite --> OptIn["Opt-in Suites Check"]
OptIn --> |Enabled| APIAccess["API Access Granted"]
OptIn --> |Disabled| LocalOnly["Local-only Execution"]
APIAccess --> AuditValidation["Audit Event Validation"]
LocalOnly --> AuditValidation
AuditValidation --> Results["Test Results Generated"]
```

**Diagram sources**
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)
- [vitest.config.ts:6-9](file://vitest.config.ts#L6-L9)

**Section sources**
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)
- [vitest.config.ts:6-9](file://vitest.config.ts#L6-L9)

### Engine Calculation Validation (Unit Tests)
Purpose:
- Validate deterministic calculation logic for upper limb PI% computation.

Key areas covered:
- Combined values chart and cap logic
- ROM lookup interpolation and boundary conditions
- Amputation scoring and caps
- Full assessment flow with neurological exclusion and suppression rules

Assertion patterns:
- Equality checks for exact values
- Range checks and tolerance comparisons
- Conditional suppression based on flags and anatomical constraints

```mermaid
flowchart TD
Start(["Start Calculation"]) --> Empty["Empty assessment -> 0%"]
Start --> ROMOnly["ROM-only scenario"]
Start --> NeuroExcl["Neurological ROM-from-Nerve gate"]
Start --> AmpSuppress["Arm amputation suppresses distal ROM"]
ROMOnly --> ROMCap["ROM total capped at 100%"]
NeuroExcl --> ExcludeROM["Exclude ROM contribution"]
AmpSuppress --> AmpOverride["Amputation dominates final %"]
ROMCap --> Result["Final percent computed"]
ExcludeROM --> Result
AmpOverride --> Result
Empty --> Result
```

**Diagram sources**
- [upperLimb.test.ts:84-156](file://tests/engine/upperLimb.test.ts#L84-L156)

**Section sources**
- [upperLimb.test.ts:14-156](file://tests/engine/upperLimb.test.ts#L14-L156)

### Policy Engine Validation (V2)
Purpose:
- Validate routing and tool-proposal decisions under varying confidence, grounding, and session states.

Key areas covered:
- Low-confidence forcing clarification
- Multi-system gating for global CVC
- Structured-live avoidance of lookup-first for confirmed DBE matches
- Prevention of repeated clarification prompts after explicit selection
- Short-form continuations treated as delegation

```mermaid
sequenceDiagram
participant Test as "Policy Test"
participant Policy as "makePolicyDecision"
participant Route as "RouteDecision"
participant Utter as "NormalizedUtterance"
participant Ground as "GroundingResult"
participant State as "V2 Session State"
Test->>Policy : Call with route, utterance, grounding, state
Policy->>Route : Read confidence/systems/reasons
Policy->>Utter : Inspect tokens/raw for short forms
Policy->>Ground : Check DBE/ontology matches
Policy->>State : Check pendingClarification
Policy-->>Test : Action + proposed tools
```

**Diagram sources**
- [policyEngine.test.ts:20-123](file://tests/v2/policyEngine.test.ts#L20-L123)

**Section sources**
- [policyEngine.test.ts:20-123](file://tests/v2/policyEngine.test.ts#L20-L123)

### Semantic Shadow Testing (P1-A)
Purpose:
- Optional integration-grade validation using a real LLM to interpret inputs and grade outcomes against curated goldens.

Opt-in mechanism:
- Controlled by environment flags; when enabled, tests invoke the real semantic interpreter and assert on outcome classes and safety.

```mermaid
sequenceDiagram
participant Test as "P1-A Shadow Runner"
participant Env as "Environment Flags"
participant Loader as "Gemini Client"
participant Interp as "runSemanticInterpreter"
participant Grader as "gradeSemanticCase"
participant Sum as "summarizeShadowResults"
Test->>Env : Check GATIOD_RUN_SEMANTIC_SHADOW/GEMINI_API_KEY
alt Enabled and API key present
Test->>Loader : Instantiate client
loop For each golden
Test->>Interp : Interpret input
Interp-->>Test : Semantic result
Test->>Grader : Grade case
Grader-->>Test : Outcome + score
end
Test->>Sum : Aggregate results
Sum-->>Test : Summary stats
Test-->>Test : Assert soft/hard gates
else Disabled or missing API key
Test-->>Test : Skip or fail fast with message
end
```

**Diagram sources**
- [p1A.shadowRunner.test.ts:30-94](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L30-L94)

**Section sources**
- [p1A.shadowRunner.test.ts:10-94](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L10-L94)
- [p1A.semanticShadowGrader.test.ts:10-323](file://tests/v2/p1A.semanticShadowGrader.test.ts#L10-L323)

### Excel Shadow Runner (Per-System and Cross-System)
Purpose:
- Enforce ADR-0001 promotion thresholds by driving realistic multi-turn conversations against the workbook scenarios.

Per-system shadow:
- Loads scenarios, runs processChatV2, grades outcomes, and writes calibration reports.
- Applies deterministic sampling and ADR-0001 thresholds per system.

Cross-system shadow:
- Validates Global CVC end-to-end across multiple components, measuring offer/executed rates and final PI% match.

```mermaid
flowchart TD
S0["Load Excel Fixture"] --> S1["Filter Scenarios (single/cross)"]
S1 --> S2["Biased Deterministic Sample"]
S2 --> S3["Run processChatV2 (shadow)"]
S3 --> S4{"Turn Logic"}
S4 --> |Structured Confirm| S5["Send 'Confirmed'"]
S4 --> |Global CVC Offer| S6["Send 'Combine'"]
S4 --> |Final Result| S7["Capture Final PI%"]
S4 --> |Stall| S8["Stop and record"]
S5 --> S3
S6 --> S3
S7 --> S9["Grade Outcome (per component)"]
S8 --> S9
S9 --> S10["Write Calibration Report"]
```

**Diagram sources**
- [runSystemShadowSample.ts:100-187](file://tests/v2/excelScenarios/runSystemShadowSample.ts#L100-L187)
- [gradeShadowOutcome.ts:36-128](file://tests/v2/excelScenarios/gradeShadowOutcome.ts#L36-L128)
- [crossSystem.shadow.test.ts:139-267](file://tests/v2/excelScenarios/crossSystem.shadow.test.ts#L139-L267)

**Section sources**
- [loadFixture.ts:16-50](file://tests/v2/excelScenarios/loadFixture.ts#L16-L50)
- [scenarioTypes.ts:7-97](file://tests/v2/excelScenarios/scenarioTypes.ts#L7-L97)
- [runSystemShadowSample.ts:34-82](file://tests/v2/excelScenarios/runSystemShadowSample.ts#L34-L82)
- [gradeShadowOutcome.ts:164-180](file://tests/v2/excelScenarios/gradeShadowOutcome.ts#L164-L180)
- [crossSystem.shadow.test.ts:139-267](file://tests/v2/excelScenarios/crossSystem.shadow.test.ts#L139-L267)

### **New** Audit Payload Validation Tests
Purpose:
- Comprehensive validation of audit event payloads ensuring privacy-preserving data handling and proper event structure.
- Validates Global CVC exclusion and re-inclusion audit events with detailed payload information.

Key validation areas:
- **Privacy preservation**: Source text plaintext is excluded from audit payloads, only SHA-256 hashes are stored.
- **Structured interpretation**: Full candidate systems and findings data is captured for downstream processing.
- **Global CVC operations**: Detailed audit events for exclusion, re-inclusion, and offer staleness scenarios.
- **JSON serialization**: Audit payloads survive JSON.stringify round-trips for persistence compatibility.

```mermaid
flowchart TD
A["Audit Event Generation"] --> B["Privacy Filtering"]
B --> C["Source Text Hash Only"]
C --> D["Structured Data Capture"]
D --> E["Candidate Systems List"]
E --> F["Candidate Findings List"]
F --> G["Validation Checks"]
G --> H["JSON Serialization Test"]
H --> I["Audit Event Persistence"]
I --> J["Downstream Processing"]
```

**Diagram sources**
- [p1B2.auditPayloadExpansion.test.ts:79-241](file://tests/v2/p1B2.auditPayloadExpansion.test.ts#L79-L241)
- [p1B.cvcExclusion.test.ts:67-198](file://tests/v2/p1B.cvcExclusion.test.ts#L67-L198)

**Section sources**
- [p1B2.auditPayloadExpansion.test.ts:8-241](file://tests/v2/p1B2.auditPayloadExpansion.test.ts#L8-L241)
- [p1B.cvcExclusion.test.ts:11-199](file://tests/v2/p1B.cvcExclusion.test.ts#L11-L199)

### Readiness and Argument Builder Validation (V2 Upper Limb)
Purpose:
- Validate readiness checks and argument construction for the upper limb system, including schema validation and provenance tracking.

Key areas covered:
- Pending observations, missing side, and rom-from-nerve gate
- Zero-fill behavior and schema validation for invalid inputs
- Provenance tracking via factsHash

**Section sources**
- [upperLimb.readinessAndArgBuilder.test.ts:19-85](file://tests/v2/upperLimb/readinessAndArgBuilder.test.ts#L19-L85)
- [upperLimb.readinessAndArgBuilder.test.ts:89-156](file://tests/v2/upperLimb/readinessAndArgBuilder.test.ts#L89-L156)

## Dependency Analysis
- Test configuration depends on dotenv loading for optional suites.
- Shadow runners depend on V2 contracts and state machine internals.
- Excel shadow runner depends on scenario fixtures and grading logic.
- **Enhanced**: Audit validation tests depend on audit event generation and privacy-preserving data handling.
- CI workflow orchestrates default tests, fixture freshness, shadow suite, and promotion checks.
- **New**: Environment variable management affects all test suites uniformly.

```mermaid
graph TB
VC["vitest.config.ts"] --> ST["tests/setup.ts"]
ST --> ET["tests/engine/upperLimb.test.ts"]
ST --> PT["tests/v2/policyEngine.test.ts"]
ST --> SR["tests/v2/semanticShadow/p1A.shadowRunner.test.ts"]
ST --> SG["tests/v2/p1A.semanticShadowGrader.test.ts"]
ST --> LF["tests/v2/excelScenarios/loadFixture.ts"]
ST --> AP["tests/v2/p1B2.auditPayloadExpansion.test.ts"]
ST --> CE["tests/v2/p1B.cvcExclusion.test.ts"]
LF --> RS["tests/v2/excelScenarios/runSystemShadowSample.ts"]
LF --> GO["tests/v2/excelScenarios/gradeShadowOutcome.ts"]
LF --> CS["tests/v2/excelScenarios/crossSystem.shadow.test.ts"]
AP --> AL["src/db/auditLog.ts"]
CE --> CS2["src/chat/chatServiceV2.ts"]
CI["ci.yml"] --> |Default| VC
CI --> |Shadow| SR
CI --> |Promotion| RS
```

**Diagram sources**
- [vitest.config.ts:1-12](file://vitest.config.ts#L1-L12)
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)
- [upperLimb.test.ts:1-156](file://tests/engine/upperLimb.test.ts#L1-L156)
- [policyEngine.test.ts:1-123](file://tests/v2/policyEngine.test.ts#L1-L123)
- [p1A.shadowRunner.test.ts:1-94](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L1-L94)
- [p1A.semanticShadowGrader.test.ts:1-323](file://tests/v2/p1A.semanticShadowGrader.test.ts#L1-L323)
- [loadFixture.ts:1-50](file://tests/v2/excelScenarios/loadFixture.ts#L1-L50)
- [runSystemShadowSample.ts:1-187](file://tests/v2/excelScenarios/runSystemShadowSample.ts#L1-L187)
- [gradeShadowOutcome.ts:1-180](file://tests/v2/excelScenarios/gradeShadowOutcome.ts#L1-L180)
- [crossSystem.shadow.test.ts:1-267](file://tests/v2/excelScenarios/crossSystem.shadow.test.ts#L1-L267)
- [p1B2.auditPayloadExpansion.test.ts:1-241](file://tests/v2/p1B2.auditPayloadExpansion.test.ts#L1-L241)
- [p1B.cvcExclusion.test.ts:1-199](file://tests/v2/p1B.cvcExclusion.test.ts#L1-L199)
- [auditLog.ts:51-90](file://src/db/auditLog.ts#L51-L90)
- [chatServiceV2.ts:984-1005](file://src/chat/chatServiceV2.ts#L984-L1005)
- [ci.yml:1-60](file://.github/workflows/ci.yml#L1-L60)

**Section sources**
- [vitest.config.ts:1-12](file://vitest.config.ts#L1-L12)
- [ci.yml:26-60](file://.github/workflows/ci.yml#L26-L60)

## Performance Considerations
- Shadow runners are opt-in and can be slow; use environment flags to control execution.
- **Enhanced**: Environment variable loading occurs once per test run, reducing overhead for opt-in suites.
- Prefer deterministic sampling strategies to keep test runs predictable and fast.
- Use memory-backed databases for shadow runs to avoid I/O overhead.
- Keep assertion timeouts reasonable; long-running suites should be isolated from default CI.
- **New**: Audit payload validation tests are lightweight and run quickly alongside other unit tests.

## Troubleshooting Guide
Common issues and resolutions:
- Missing environment variables for optional suites:
  - Ensure dotenv is loaded once via setup.ts and environment flags are set appropriately.
  - **Enhanced**: Check that setup.ts is properly configured in vitest.config.ts setupFiles array.
- Semantic shadow runner skips unexpectedly:
  - Verify both the opt-in flag and API key are set; the runner will fail fast with a clear message if the API key is missing.
- Excel shadow runner stalls or errors:
  - Check session state and tool plan outputs; ensure shadow mode is enabled and the assistant responds as expected.
- CI failures on fixture freshness:
  - Regenerate the Excel fixture and commit the updated JSON; CI enforces that the generated file matches the workbook.
- **New**: Audit payload validation failures:
  - Verify that privacy-preserving data handling is working correctly (source text hash only, no plaintext).
  - Check that structured interpretation data is properly captured in audit events.

**Section sources**
- [setup.ts:1-8](file://tests/setup.ts#L1-L8)
- [vitest.config.ts:6-9](file://vitest.config.ts#L6-L9)
- [p1A.shadowRunner.test.ts:37-44](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L37-L44)
- [ci.yml:45-48](file://.github/workflows/ci.yml#L45-L48)

## Conclusion
The testing strategy combines deterministic unit tests, scenario-driven shadow validation, and CI-enforced promotion gates. Engine and policy logic are validated in isolation, while shadow runners simulate real-world interactions. The architecture supports opt-in integration tests, robust reporting, and strict quality gates aligned with ADR-0001. **Enhanced** with improved environment variable management and comprehensive audit payload validation capabilities for healthcare compliance and data privacy.

## Appendices

### Writing New Tests
Guidelines:
- Place unit tests under tests/engine or tests/v2 according to scope.
- Use descriptive describe/it blocks and clear assertions.
- For V2 tests, construct minimal, valid inputs and assert on outcomes and tool plans.
- For shadow tests, use environment flags to gate optional integrations.
- Keep test data in fixtures or constants; avoid embedding large literals inline.
- **New**: For audit-related tests, focus on privacy-preserving data handling and structured payload validation.

**Section sources**
- [README.md:70-77](file://README.md#L70-L77)
- [vitest.config.ts:3-11](file://vitest.config.ts#L3-L11)

### Test Data Management
- Excel fixtures are generated from the workbook and committed; CI enforces freshness.
- Scenario types define expected outcome classes and overrides; maintain these consistently.
- Shadow runners write calibration reports for post-run analysis.
- **New**: Audit event data is validated for privacy compliance and structured interpretation completeness.

**Section sources**
- [0001-structured-live-promotion-gate.md:13-17](file://docs/adr/0001-structured-live-promotion-gate.md#L13-L17)
- [scenarioTypes.ts:7-97](file://tests/v2/excelScenarios/scenarioTypes.ts#L7-L97)
- [runSystemShadowSample.ts:182-186](file://tests/v2/excelScenarios/runSystemShadowSample.ts#L182-L186)

### Continuous Integration Testing
- Default CI runs type check, default test suite, and promotion checks.
- Excel shadow suite is gated behind an environment flag and ADR-0001 thresholds.
- Promotion checks validate that every structured_live system meets current thresholds.
- **Enhanced**: Environment variable management is handled centrally for consistent CI execution.
- **New**: Audit payload validation runs automatically as part of the default test suite.

**Section sources**
- [ci.yml:26-60](file://.github/workflows/ci.yml#L26-L60)
- [0001-structured-live-promotion-gate.md:38-56](file://docs/adr/0001-structured-live-promotion-gate.md#L38-L56)

### Performance and Regression Testing
- Use opt-in shadow suites for performance-sensitive validations.
- Track safe-outcome and exact-calculation rates; regressions are flagged by thresholds.
- Maintain deterministic sampling to ensure stable baselines across runs.
- **New**: Audit payload validation adds minimal overhead to test execution time.

**Section sources**
- [runSystemShadowSample.ts:34-82](file://tests/v2/excelScenarios/runSystemShadowSample.ts#L34-L82)
- [crossSystem.shadow.test.ts:250-266](file://tests/v2/excelScenarios/crossSystem.shadow.test.ts#L250-L266)

### Quality Assurance Processes
- Hard gates: unsafe outcomes must be zero in shadow runners.
- Soft gates: minimum pass rates for curated sets.
- Promotion gates: structured_live systems must meet per-system thresholds continuously.
- **New**: Audit gates: privacy compliance and structured data completeness must be maintained.
- **New**: Global CVC operational gates: exclusion/re-inclusion events must be properly logged.

**Section sources**
- [p1A.shadowRunner.test.ts:21-28](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L21-L28)
- [0001-structured-live-promotion-gate.md:29-56](file://docs/adr/0001-structured-live-promotion-gate.md#L29-L56)
- [p1B2.auditPayloadExpansion.test.ts:173-195](file://tests/v2/p1B2.auditPayloadExpansion.test.ts#L173-L195)
- [p1B.cvcExclusion.test.ts:67-146](file://tests/v2/p1B.cvcExclusion.test.ts#L67-L146)

### Debugging Techniques
- Enable verbose logging in shadow runners to inspect per-case grades.
- Use calibration reports to identify mismatches and refine expectations.
- Validate readiness and argument builders with minimal, targeted inputs.
- **New**: For audit-related debugging, inspect audit event payloads for privacy compliance and structured data completeness.
- **New**: Use audit trail queries to verify event persistence and data integrity.

**Section sources**
- [p1A.shadowRunner.test.ts:63-81](file://tests/v2/semanticShadow/p1A.shadowRunner.test.ts#L63-L81)
- [runSystemShadowSample.ts:140-177](file://tests/v2/excelScenarios/runSystemShadowSample.ts#L140-L177)

### Coverage Requirements and Best Practices for Healthcare
- Prefer deterministic unit tests for core logic; ensure boundary conditions are covered.
- Use shadow runners to validate real-world scenarios and safety.
- Maintain clear outcome classes and hard/soft gates to prevent silent regressions.
- Keep environment-controlled opt-in suites to preserve CI performance while enabling deep validation.
- **New**: Ensure all audit events comply with healthcare data privacy regulations.
- **New**: Validate that sensitive clinical data is handled appropriately in test environments.
- **New**: Implement comprehensive audit payload validation to support compliance and monitoring requirements.