# RAG

The retrieval layer that grounds clinical utterances in GATIOD-specific vocabulary before routing and extraction. Provides keyword search over the GATIOD dictionary, ontology-based canonical concept matching, and chapter-based text retrieval. This context does not run the LLM — it feeds signals to the V2 pipeline and the semantic interpreter.

## Language

### Knowledge sources

**Dictionary**:
`knowledge/dictionary.json` — 592 clinical terms with canonical term, plain-English meaning, usage note, category tag, and chapter reference. The primary human-curated knowledge source.
_Avoid_: "glossary", "term list"

**Chapter content**:
Textual content from the GATIOD clinical handbook, either as per-chapter text files or extracted from `gatiod.pdf`. Split into overlapping chunks for retrieval.
_Avoid_: "PDF content", "handbook"

**System synonyms**:
`src/v2/systemSynonyms.ts` — a curated mapping from clinical terms and phrases to GATIOD system keys with confidence scores. Used by the router for keyword-based system detection and by the ontology index for concept aliases.
_Avoid_: "synonym table", "keyword map"

### Retrieval components

**Dictionary index**:
`src/rag/dictionaryIndex.ts` — loads the dictionary and supports exact and substring matching across term, meaning, and usage fields. Exact match is returned before substring matches.
_Avoid_: "dictionary search", "term lookup"

**Ontology index**:
`src/v2/ontologyIndex.ts` — builds canonical concept entries from engine data (amputations, nerves, DBEs, spine categories/severities) and system synonyms. Scores matches using precision/recall over tokenized input.
_Avoid_: "concept index", "entity index"

**Chapter retriever**:
`src/v2/chapterRetriever.ts` — chunks chapter content into overlapping windows and scores each chunk against a query by token overlap. Returns the top-N citations with chapter, section, snippet, and score.
_Avoid_: "PDF retriever", "text search"

**Hybrid retriever**:
`src/v2/hybridRetriever.ts` — merges chapter citations and ontology matches, sorts by score, and returns a capped `GroundingResult`. The single retrieval entry point for the V2 pipeline.
_Avoid_: "combined retriever", "merged retriever"

### Output types

**Grounding result**:
The output of the hybrid retriever: a ranked list of `GroundingCitation` and `OntologyMatch` records. Passed to the router and semantic interpreter to enrich their analysis.
_Avoid_: "retrieval result", "search result"

**Grounding citation**:
A single snippet from chapter content with `{ source, chapter, section, label, snippet, score }`. Sourced by the chapter retriever.

**Ontology match**:
A canonical concept match from the ontology index: `{ system, type, canonicalId, label, score, aliases }`. Used by the router to identify which GATIOD system an utterance targets.

**Overlap score**:
The retrieval relevance metric used by both the chapter retriever and ontology index. Computed as a precision/recall combination over tokenized query vs. candidate. Exact phrase matches receive a bonus.
_Avoid_: "similarity score", "relevance score"

## Relationships

- **Dictionary index** and **chapter retriever** and **ontology index** → all feed into **hybrid retriever**
- **Hybrid retriever** → produces **grounding result** → consumed by the V2 router and semantic interpreter
- **System synonyms** → used by both **ontology index** (for concept aliases) and the V2 router (for keyword system detection)
- **Dictionary** (human-curated terms) and **ontology index** (engine-derived concepts) are independent sources; the hybrid retriever merges them

## Example dialogue

> **Dev:** "If a doctor says 'rotator cuff tear', how does the system know that's upper limb?"
> **Domain expert:** "The **system synonyms** table has 'rotator cuff' mapped to `upper_limb` with high confidence. The **hybrid retriever** returns an **ontology match** for it; the router sees the match and routes to upper limb."

> **Dev:** "What's the difference between the dictionary and the ontology?"
> **Domain expert:** "The **dictionary** is human-curated plain-English definitions — good for what a term *means*. The **ontology** is machine-built from engine data — good for knowing *which system* and *which canonical ID* a term maps to. Both are useful; that's why we merge them in the **hybrid retriever**."

## Flagged ambiguities

- "RAG" — used loosely for the whole `src/rag/` context and also for some modules in `src/v2/` (ontology, chapter retriever, hybrid retriever). The canonical RAG entry point (`dictionaryIndex.ts`) lives in `src/rag/`; the retrieval pipeline is split across `src/rag/` and `src/v2/`.
