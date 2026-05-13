# Integration notes for `gatiod-chat-assistant`

## Where this data fits

Recommended new modules:

```text
src/conversation/
  dialogueState.ts
  dialoguePolicy.ts
  missingSlots.ts
  confirmationRenderer.ts
  resultRenderer.ts
  factPatch.ts
  policyLoader.ts
```

Recommended data location:

```text
knowledge/conversation/
  state_machine.json
  common_slots.json
  systems/*.policy.json
  response_templates.json
  chips.json
  extraction_patch_rules.json
```

## Runtime flow

```text
processChat()
  -> extract facts / proposed patches
  -> load active system policy
  -> compute missing slots
  -> decide next action
  -> render question / confirmation / deterministic result
```

## Non-negotiable guard

Do not render a final PI% unless the response is backed by a successful `assess_*` tool result.

## Suggested first implementation slice

1. Load `upper_limb.policy.json`.
2. Add state `COLLECTING_FACTS -> READY_TO_CONFIRM -> AWAITING_CONFIRMATION -> CALCULATING`.
3. Move `[CHIPS: ...]` generation out of the system prompt and into `chips.json` / missing slot policy.
4. Add tests from `tests/conversation_golden_cases.json`.
5. Repeat for lower limb and spine.
