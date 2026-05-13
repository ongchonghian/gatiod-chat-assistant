import type { GroundingResult } from "./contracts.js";
import { searchChapterGrounding } from "./chapterRetriever.js";
import { searchOntology } from "./ontologyIndex.js";

export function retrieveGrounding(query: string): GroundingResult {
  const ontologyMatches = searchOntology(query, 10);
  const chapterCitations = searchChapterGrounding(query, 5);

  const ontologyCitations = ontologyMatches.slice(0, 5).map((m) => ({
    source: "ontology" as const,
    label: `${m.system}: ${m.label}`,
    snippet: `Matched canonical ${m.type} '${m.canonicalId}' from ${m.system}`,
    score: m.score,
  }));

  const citations = [...chapterCitations, ...ontologyCitations]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    citations,
    ontologyMatches,
  };
}
