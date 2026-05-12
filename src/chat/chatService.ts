/**
 * Chat Service — orchestrates Gemini with function calling.
 * Uses database-backed sessions, audit logging, and error recovery.
 */

import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionCall,
  type GenerateContentResult,
} from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { TOOL_DECLARATIONS, MULTI_SYSTEM_TOOL_DECLARATIONS } from "../tools/toolSchemas.js";
import { handleToolCall } from "../tools/toolHandlers.js";
import { saveSession, loadSession, deleteSession } from "../db/sessionStore.js";
import { logAuditEvent } from "../db/auditLog.js";

export interface ChatResponse {
  message: string;
  toolCalls?: { name: string; result: unknown }[];
  suggestedChips?: string[];
  sessionId: string;
}

/** Extract [CHIPS: ...] from LLM response text. Returns cleaned text and chips array. */
function extractChips(text: string): { cleanText: string; chips: string[] } {
  const match = text.match(/\[CHIPS:\s*(.+?)\]\s*$/);
  if (!match) return { cleanText: text, chips: [] };
  const cleanText = text.slice(0, match.index).trimEnd();
  const chips = match[1].split("|").map((c) => c.trim()).filter(Boolean);
  return { cleanText, chips };
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

export async function processChat(
  sessionId: string,
  userMessage: string,
  opts?: { userId?: string; claimId?: string }
): Promise<ChatResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required");

  // Check feature flag
  if (process.env.GATIOD_CHAT_ENABLED === "false") {
    throw new Error("GATIOD chat assessment is currently disabled.");
  }

  // Load or create session from database
  const existing = loadSession(sessionId);
  const history: Content[] = existing?.history ?? [];

  // Audit: session start or user message
  if (history.length === 0) {
    logAuditEvent({ sessionId, userId: opts?.userId, eventType: "session_start", eventData: { claimId: opts?.claimId } });
  }
  logAuditEvent({ sessionId, userId: opts?.userId, eventType: "user_message", eventData: { message: userMessage } });

  // Add user message to history
  history.push({ role: "user", parts: [{ text: userMessage }] });

  // Persist before calling Gemini (so session survives API failures)
  saveSession(sessionId, history, { userId: opts?.userId, claimId: opts?.claimId });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: [...TOOL_DECLARATIONS, ...MULTI_SYSTEM_TOOL_DECLARATIONS] }],
  });

  const toolCallLog: { name: string; result: unknown }[] = [];
  const MAX_ITERATIONS = 20;
  let maxIterations = MAX_ITERATIONS;
  let emptyStopRetries = 0;

  while (maxIterations-- > 0) {
    let response: GenerateContentResult;

    // Call Gemini with retry
    try {
      response = await callGeminiWithRetry(model, history);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logAuditEvent({ sessionId, userId: opts?.userId, eventType: "error", eventData: { error: errorMsg } });
      saveSession(sessionId, history, { userId: opts?.userId, claimId: opts?.claimId });

      // User-friendly error
      if (errorMsg.includes("429") || errorMsg.includes("quota")) {
        throw new Error("The AI service is temporarily rate-limited. Your session is saved — please try again in a moment.");
      }
      if (errorMsg.includes("timeout") || errorMsg.includes("ECONNREFUSED")) {
        throw new Error("The AI service is temporarily unavailable. Your session is saved — please try again in a moment.");
      }
      throw new Error(`Assessment service error. Your session is saved. Details: ${errorMsg}`);
    }

    const candidate = response.response.candidates?.[0];
    if (!candidate?.content?.parts) {
      const reason = candidate?.finishReason ?? (response.response.candidates?.length === 0 ? "no_candidates" : "no_content");
      console.error(`[GATIOD] No content in response: finishReason=${reason}, iteration=${MAX_ITERATIONS - maxIterations}, tools=${toolCallLog.map((t) => t.name).join(",") || "none"}`);
      if (reason === "SAFETY") {
        return { message: "The assessment content was flagged for review. Please try rephrasing the clinical findings.", sessionId };
      }
      // Gemini 2.5 Flash thinking model occasionally returns STOP with null content
      // when it wants to make a function call but produces no visible output.
      // Inject a nudge and retry up to 3 times before giving up.
      if (reason === "STOP" && emptyStopRetries < 3) {
        emptyStopRetries++;
        console.warn(`[GATIOD] Empty STOP response, injecting nudge (retry ${emptyStopRetries}/3)`);
        history.push({ role: "user", parts: [{ text: "Please proceed with the assessment calculation now." }] });
        continue;
      }
      break;
    }
    emptyStopRetries = 0;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: FunctionCall } => "functionCall" in p
    );

    if (functionCalls.length === 0) {
      // Final text response — extract chips before storing
      const rawText = parts.filter((p): p is Part & { text: string } => "text" in p).map((p) => p.text).join("");
      const { cleanText, chips } = extractChips(rawText);
      history.push({ role: "model", parts: [{ text: cleanText }] });

      logAuditEvent({ sessionId, userId: opts?.userId, eventType: "assistant_message", eventData: { message: cleanText.substring(0, 500), toolCallCount: toolCallLog.length, chipCount: chips.length } });
      saveSession(sessionId, history, { userId: opts?.userId, claimId: opts?.claimId });

      return {
        message: cleanText,
        toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
        suggestedChips: chips.length > 0 ? chips : undefined,
        sessionId,
      };
    }

    // Push full model response to history (includes thought tokens from gemini-2.5 thinking models)
    history.push({ role: "model", parts });

    const functionResponses: Part[] = [];
    for (const fc of functionCalls) {
      const { name, args } = fc.functionCall;
      const result = handleToolCall(name, (args ?? {}) as Record<string, unknown>);
      toolCallLog.push({ name, result });

      logAuditEvent({ sessionId, userId: opts?.userId, eventType: "tool_call", eventData: { tool: name, success: (result as { success: boolean }).success } });

      if (name.startsWith("assess_") && (result as { success: boolean }).success) {
        logAuditEvent({ sessionId, userId: opts?.userId, eventType: "calculation_result", eventData: { tool: name, result: (result as { data?: unknown }).data } });
      }

      functionResponses.push({ functionResponse: { name, response: result } } as Part);
    }

    history.push({ role: "function" as "user", parts: functionResponses });
    saveSession(sessionId, history, { userId: opts?.userId, claimId: opts?.claimId });
  }

  console.error(`[GATIOD] Assessment loop exhausted. Tools called: ${toolCallLog.map((t) => t.name).join(", ") || "none"}`);
  return { message: "I wasn't able to complete the assessment. Please try rephrasing your input.", sessionId };
}

async function callGeminiWithRetry(model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>, history: Content[]): Promise<GenerateContentResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await model.generateContent({ contents: history });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        console.warn(`[Gemini] Attempt ${attempt + 1} failed, retrying in ${RETRY_DELAY_MS}ms:`, lastError.message);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("Gemini API call failed");
}

export function getSessionHistory(sessionId: string): Content[] {
  const session = loadSession(sessionId);
  return session?.history ?? [];
}

export function clearSession(sessionId: string): void {
  logAuditEvent({ sessionId, eventType: "session_reset", eventData: {} });
  deleteSession(sessionId);
}
