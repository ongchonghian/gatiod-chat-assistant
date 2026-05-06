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
  sessionId: string;
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
  let maxIterations = 10;

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
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: FunctionCall } => "functionCall" in p
    );

    if (functionCalls.length === 0) {
      // Final text response
      const text = parts.filter((p): p is Part & { text: string } => "text" in p).map((p) => p.text).join("");
      history.push({ role: "model", parts: [{ text }] });

      logAuditEvent({ sessionId, userId: opts?.userId, eventType: "assistant_message", eventData: { message: text.substring(0, 500), toolCallCount: toolCallLog.length } });
      saveSession(sessionId, history, { userId: opts?.userId, claimId: opts?.claimId });

      return { message: text, toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined, sessionId };
    }

    // Execute tool calls
    history.push({ role: "model", parts: functionCalls.map((fc) => ({ functionCall: fc.functionCall })) });

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
