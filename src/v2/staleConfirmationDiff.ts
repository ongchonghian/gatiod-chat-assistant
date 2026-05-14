/**
 * Stale-confirmation diff — pure transform from two factsHash snapshots into
 * a doctor-readable list of changed fields. Slice #12 of the multi-system
 * claim completion PRD.
 *
 * Used by chatServiceV2 to emit a single "Re-confirm with N changes" chip
 * message in chat when a system's confirmation transitions to `"stale"`.
 * Reuses `src/v2/clinicalLabels.ts` for field labels and enum translations
 * — no raw schema keys appear in doctor-facing output.
 */

import type { GatiodSystemKey, V2SystemFacts } from "./contracts.js";
import { factKeyLabel, factValueDisplay } from "./clinicalLabels.js";

export interface DiffLine {
  /** Human-readable field label, e.g. "Region", "ASIA grade". */
  label: string;
  /** Display string of the previous value (omitted when added). */
  oldValue?: string;
  /** Display string of the new value (omitted when removed). */
  newValue?: string;
  kind: "added" | "removed" | "changed";
}

/**
 * Compare two V2SystemFacts maps and produce a doctor-readable diff. Returns
 * `[]` for identical inputs. Lines are returned in stable alphabetical order
 * of fact key so the rendered output is deterministic across runs.
 *
 * Internal-only fact keys (those prefixed with `_`) are filtered out — they
 * exist to thread routing state through the pipeline and aren't doctor-facing.
 */
export function diffFacts(
  system: GatiodSystemKey,
  oldFacts: V2SystemFacts,
  newFacts: V2SystemFacts,
): DiffLine[] {
  const keys = new Set<string>();
  for (const k of Object.keys(oldFacts)) if (!k.startsWith("_")) keys.add(k);
  for (const k of Object.keys(newFacts)) if (!k.startsWith("_")) keys.add(k);

  const lines: DiffLine[] = [];
  for (const key of Array.from(keys).sort()) {
    const oldFact = oldFacts[key];
    const newFact = newFacts[key];
    const label = factKeyLabel(system, key);
    const oldValueDisplay = oldFact !== undefined ? factValueDisplay(system, key, oldFact.value) : undefined;
    const newValueDisplay = newFact !== undefined ? factValueDisplay(system, key, newFact.value) : undefined;

    if (oldFact === undefined && newFact !== undefined) {
      lines.push({ label, newValue: newValueDisplay, kind: "added" });
      continue;
    }
    if (oldFact !== undefined && newFact === undefined) {
      lines.push({ label, oldValue: oldValueDisplay, kind: "removed" });
      continue;
    }
    if (oldFact && newFact && oldValueDisplay !== newValueDisplay) {
      lines.push({ label, oldValue: oldValueDisplay, newValue: newValueDisplay, kind: "changed" });
    }
  }
  return lines;
}

/**
 * Render a DiffLine[] as a compact multi-line chat message. The chat layer
 * appends this under a "Re-confirm with N change(s)" header when a
 * system's confirmation goes stale.
 */
export function formatDiffLines(lines: ReadonlyArray<DiffLine>): string {
  return lines
    .map((l) => {
      switch (l.kind) {
        case "added":   return `+ ${l.label}: ${l.newValue}`;
        case "removed": return `− ${l.label}: ${l.oldValue}`;
        case "changed": return `↻ ${l.label}: ${l.oldValue} → ${l.newValue}`;
      }
    })
    .join("\n");
}
