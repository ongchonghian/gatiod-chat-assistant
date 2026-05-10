// Production SemanticModelClient backed by Google Gemini (ADR-0003 Slice F).
//
// Uses Gemini's JSON response mode with a deterministic temperature. The
// adapter (`semanticInterpreter.ts`) is responsible for parsing and
// validating the output — this module only handles the model call.
//
// The client is constructed lazily so the absence of `GEMINI_API_KEY` only
// matters when the semantic interpreter is actually invoked
// (`SEMANTIC_INTERPRETER_ENABLED=true`). All default-CI tests use a mocked
// `SemanticModelClient` and never reach this module.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SemanticModelClient } from "./semanticInterpreter.js";

/** Configuration for the Gemini-backed semantic model client. */
export interface GeminiSemanticClientOptions {
  /** Override the API key (default: process.env.GEMINI_API_KEY). */
  apiKey?: string;
  /** Override the default model (default: SEMANTIC_INTERPRETER_MODEL env or
   *  "gemini-2.5-flash"). */
  defaultModel?: string;
  /** Sampling temperature; 0 by default per REQ-SC-OUTPUT-001. */
  temperature?: number;
}

export class GeminiSemanticModelClient implements SemanticModelClient {
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly temperature: number;

  constructor(opts: GeminiSemanticClientOptions = {}) {
    const key = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GeminiSemanticModelClient requires GEMINI_API_KEY (or apiKey option).",
      );
    }
    this.apiKey = key;
    this.defaultModel =
      opts.defaultModel ??
      process.env.SEMANTIC_INTERPRETER_MODEL ??
      "gemini-2.5-flash";
    this.temperature = opts.temperature ?? 0;
  }

  async generate(args: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
  }): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: args.model ?? this.defaultModel,
      systemInstruction: args.systemPrompt,
      generationConfig: {
        temperature: this.temperature,
        // JSON mode — Gemini constrains output to valid JSON. The adapter
        // additionally tolerates ```json fences in case the model wraps it.
        responseMimeType: "application/json",
      },
    });

    const response = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: args.userMessage }] }],
    });

    const text = response.response.text();
    if (!text || text.trim().length === 0) {
      throw new Error("Gemini returned empty response.");
    }
    return text;
  }
}
