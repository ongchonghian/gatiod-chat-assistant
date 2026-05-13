import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import type { GroundingCitation } from "./contracts.js";

interface ChapterChunk {
  id: string;
  chapter: number;
  section: string;
  text: string;
}

let chunkCache: ChapterChunk[] | null = null;

function parseChapterText(raw: string): ChapterChunk[] {
  const chunks: ChapterChunk[] = [];
  const chapterRegex = /CHAPTER\s+(\d+)\b([\s\S]*?)(?=CHAPTER\s+\d+\b|APPENDIX\s+\d+|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = chapterRegex.exec(raw)) !== null) {
    const chapter = Number(match[1]);
    const content = match[2].replace(/\s+/g, " ").trim();
    if (!Number.isFinite(chapter) || !content) continue;

    const sectionSize = 800;
    for (let i = 0; i < content.length; i += sectionSize) {
      const slice = content.slice(i, i + sectionSize).trim();
      if (!slice) continue;
      const section = `chunk_${Math.floor(i / sectionSize) + 1}`;
      chunks.push({
        id: `ch${chapter}_${section}`,
        chapter,
        section,
        text: slice,
      });
    }
  }

  return chunks;
}

function loadFromChapterFiles(baseDir: string): ChapterChunk[] {
  const chaptersDir = join(baseDir, "knowledge", "chapters");
  if (!existsSync(chaptersDir)) return [];

  const files = readdirSync(chaptersDir).filter((f) => f.endsWith(".txt"));
  const chunks: ChapterChunk[] = [];

  for (const file of files) {
    const text = readFileSync(join(chaptersDir, file), "utf-8");
    const chapterMatch = file.match(/chapter[_-]?(\d+)/i);
    const chapter = chapterMatch ? Number(chapterMatch[1]) : 0;
    const sectionSize = 800;
    for (let i = 0; i < text.length; i += sectionSize) {
      const slice = text.slice(i, i + sectionSize).replace(/\s+/g, " ").trim();
      if (!slice) continue;
      const section = `${file}:chunk_${Math.floor(i / sectionSize) + 1}`;
      chunks.push({ id: `${file}_${section}`, chapter, section, text: slice });
    }
  }

  return chunks;
}

function loadFromPdf(baseDir: string): ChapterChunk[] {
  const pdfPath = join(baseDir, "gatiod.pdf");
  if (!existsSync(pdfPath)) return [];

  try {
    const extracted = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseChapterText(extracted);
  } catch {
    return [];
  }
}

function ensureChunks(): ChapterChunk[] {
  if (chunkCache) return chunkCache;
  const baseDir = process.cwd();
  const fromFiles = loadFromChapterFiles(baseDir);
  if (fromFiles.length > 0) {
    chunkCache = fromFiles;
    return chunkCache;
  }

  chunkCache = loadFromPdf(baseDir);
  return chunkCache;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function overlapScore(queryTokens: string[], text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0 || queryTokens.length === 0) return 0;

  let overlap = 0;
  for (const q of queryTokens) {
    if (tokens.includes(q)) overlap += 1;
  }

  return overlap / queryTokens.length;
}

export function searchChapterGrounding(query: string, limit = 5): GroundingCitation[] {
  const chunks = ensureChunks();
  if (chunks.length === 0) return [];

  const queryTokens = tokenize(query);
  return chunks
    .map((chunk) => ({ chunk, score: overlapScore(queryTokens, chunk.text) }))
    .filter((row) => row.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({
      source: "gatiod.pdf" as const,
      chapter: row.chunk.chapter,
      section: row.chunk.section,
      label: `Chapter ${row.chunk.chapter} ${row.chunk.section}`,
      snippet: row.chunk.text.slice(0, 260),
      score: Number(row.score.toFixed(3)),
    }));
}
