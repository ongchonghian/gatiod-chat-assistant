/**
 * GATIOD Dictionary Index — simple keyword search over the 592-entry dictionary.
 * For MVP, uses substring matching. claimsDex integration will use the hybrid retriever.
 */

import { readFileSync } from "fs";
import { join } from "path";

interface DictionaryEntry {
  term: string;
  meaning: string;
  usage: string;
  category: string;
  chapter: string;
}

let dictionary: DictionaryEntry[] | null = null;

function loadDictionary(): DictionaryEntry[] {
  if (dictionary) return dictionary;

  try {
    const dictPath = join(process.cwd(), "knowledge", "dictionary.json");
    const raw = readFileSync(dictPath, "utf-8");
    const parsed = JSON.parse(raw);

    // The dictionary JSON can be an array or an object with entries
    if (Array.isArray(parsed)) {
      dictionary = parsed.map((e: Record<string, string>) => ({
        term: e.term ?? e.name ?? "",
        meaning: e.meaning ?? e.definition ?? "",
        usage: e.usage ?? e.how_the_guide_uses_it ?? "",
        category: e.category ?? "",
        chapter: e.chapter ?? e.chapter_or_section ?? "",
      }));
    } else if (parsed.entries) {
      dictionary = parsed.entries;
    } else {
      // Try to parse as an object where keys are terms
      dictionary = Object.entries(parsed).map(([key, val]: [string, unknown]) => {
        const v = val as Record<string, string>;
        return {
          term: key,
          meaning: v.meaning ?? v.definition ?? "",
          usage: v.usage ?? v.how_the_guide_uses_it ?? "",
          category: v.category ?? "",
          chapter: v.chapter ?? v.chapter_or_section ?? "",
        };
      });
    }
  } catch {
    console.warn("Could not load GATIOD dictionary — search will return empty results.");
    dictionary = [];
  }

  return dictionary!;
}

export function searchDictionary(query: string): DictionaryEntry[] {
  const dict = loadDictionary();
  const q = query.toLowerCase();

  // Exact match first
  const exact = dict.filter((e) => e.term.toLowerCase() === q);
  if (exact.length > 0) return exact;

  // Substring match
  return dict.filter(
    (e) =>
      e.term.toLowerCase().includes(q) ||
      e.meaning.toLowerCase().includes(q) ||
      e.usage.toLowerCase().includes(q)
  );
}
