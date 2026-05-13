# GATIOD Conversation Policy Data

Generated: 2026-05-08T01:18:23Z

This package contains structured conversation-policy data for improving `gatiod-chat-assistant`.

It is designed to move the app from prompt-led conversation to policy-led conversation:

```text
LLM extracts facts -> policy decides next action -> deterministic tool calculates -> template renders result
```

## Contents

- `metadata.json` — package metadata and design principles
- `policy/state_machine.json` — dialogue states, transitions, and hard guards
- `policy/common_slots.json` — common slot types and global safety messages
- `policy/systems/*.policy.json` — per-system slot policy for all 9 GATIOD systems
- `policy/response_templates.json` — deterministic user-facing templates
- `policy/chips.json` — state-generated suggested chips
- `policy/extraction_patch_rules.json` — correction / fact-patch rules
- `schemas/conversation_policy.schema.json` — JSON schema for system policy files
- `tests/conversation_golden_cases.json` — initial conversation regression cases
- `docs/integration_notes.md` — implementation notes

## Intended use

Start with upper limb, lower limb, and spine. Use the same policy shape for the remaining systems.

The main behavioural change is that the assistant should ask the next required question from policy data, not from a giant system prompt.
