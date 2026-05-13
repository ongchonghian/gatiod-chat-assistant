// CI-time cross-reference verifier for V2 docs. Catches the three drift modes
// surfaced in the 2026-05-12 audit:
//
//   1. An ADR landing in docs/adr/ with no sprint section in sprints.md.
//   2. A REQ-* heading in requirements-known-issues.md with no ticket
//      reference in sprints.md.
//   3. A PROVISIONAL_STRUCTURED_LIVE entry whose reason REQ-* doesn't exist.
//
// Calibration freshness / threshold for structured_live systems is enforced
// separately by `npm run check:adr-0001-promotion`.
//
// Run via `npm run docs:verify`. Exits non-zero on any failure.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { PROVISIONAL_STRUCTURED_LIVE } from "../src/v2/systemRegistry.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADR_DIR = join(ROOT, "docs/adr");
const SPRINTS_PATH = join(ROOT, "docs/v2/sprints.md");
const REQS_PATH = join(ROOT, "docs/v2/requirements-known-issues.md");

interface AdrFrontmatter {
  id?: string;
  status?: string;
  sprint_sections?: string[];
  superseded_by?: string | null;
}

// Minimal YAML reader for the frontmatter shape we use (scalars + string lists).
// Returns null if no frontmatter block is present.
function parseFrontmatter(content: string): AdrFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const out: AdrFrontmatter = {};
  const lines = match[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const [, key, rest] = m;
    if (rest.trim() === "") {
      const list: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, "");
        list.push(item);
        i++;
      }
      (out as Record<string, unknown>)[key] = list;
    } else {
      const value = rest.trim().replace(/^["']|["']$/g, "");
      (out as Record<string, unknown>)[key] = value === "null" ? null : value;
      i++;
    }
  }
  return out;
}

function check(): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(SPRINTS_PATH)) {
    failures.push(`sprints.md not found at ${SPRINTS_PATH}`);
    return { failures, warnings };
  }
  if (!existsSync(REQS_PATH)) {
    failures.push(`requirements-known-issues.md not found at ${REQS_PATH}`);
    return { failures, warnings };
  }
  if (!existsSync(ADR_DIR)) {
    failures.push(`ADR directory not found at ${ADR_DIR}`);
    return { failures, warnings };
  }

  const sprintsContent = readFileSync(SPRINTS_PATH, "utf8");
  const reqsContent = readFileSync(REQS_PATH, "utf8");

  // Check 1 — every ADR with Accepted/Proposed status is referenced in sprints.md.
  const adrFiles = readdirSync(ADR_DIR).filter((f) => f.endsWith(".md"));
  for (const file of adrFiles) {
    const path = join(ADR_DIR, file);
    const content = readFileSync(path, "utf8");
    const fm = parseFrontmatter(content);
    if (!fm) {
      failures.push(`${file}: missing frontmatter block`);
      continue;
    }
    if (!fm.id) {
      failures.push(`${file}: frontmatter missing 'id'`);
      continue;
    }
    const status = fm.status ?? "";
    if (!["Accepted", "Proposed", "Superseded", "Deprecated"].includes(status)) {
      failures.push(`${fm.id}: invalid status "${status}" (expected Accepted | Proposed | Superseded | Deprecated)`);
      continue;
    }
    if (status === "Superseded" || status === "Deprecated") continue;
    const sections = fm.sprint_sections ?? [];
    if (sections.length === 0) {
      failures.push(`${fm.id}: status is ${status} but no sprint_sections declared in frontmatter`);
      continue;
    }
    if (!sprintsContent.includes(fm.id)) {
      failures.push(
        `${fm.id}: declares sprint_sections in ${file} but ID is not referenced anywhere in sprints.md. ` +
          `Add a sprint section that references it, or set status to Superseded.`,
      );
    }
  }

  // Check 2 — every REQ-* heading is referenced in sprints.md.
  const reqHeadings = [...reqsContent.matchAll(/^###\s+(REQ-[A-Z]\d+)\b/gm)].map((m) => m[1]);
  const reqIds = new Set(reqHeadings);
  for (const reqId of reqIds) {
    if (!sprintsContent.includes(reqId)) {
      failures.push(
        `${reqId}: heading in requirements-known-issues.md but not referenced in sprints.md. ` +
          `Add a ticket or sprint section that references ${reqId}.`,
      );
    }
  }

  // Check 3 — every PROVISIONAL_STRUCTURED_LIVE reason resolves to an existing REQ.
  for (const [system, entry] of Object.entries(PROVISIONAL_STRUCTURED_LIVE)) {
    const reason = entry?.reason;
    if (!reason) continue;
    if (!reqIds.has(reason)) {
      failures.push(
        `PROVISIONAL_STRUCTURED_LIVE.${system} cites ${reason} but no such REQ-* heading exists ` +
          `in requirements-known-issues.md.`,
      );
    }
  }

  return { failures, warnings };
}

function main(): void {
  const { failures, warnings } = check();
  if (warnings.length > 0) {
    console.log("docs:verify warnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (failures.length > 0) {
    console.error("");
    console.error("✗ docs:verify failed:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("");
    console.error('See CLAUDE.md "Keeping V2 docs in sync" for the rules.');
    process.exit(1);
  }
  console.log("✓ docs:verify passed");
}

main();
