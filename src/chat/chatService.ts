/**
 * Chat Service — orchestrates Gemini with function calling.
 * Manages conversation history and tool call execution.
 */

import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionCall,
  type GenerateContentResult,
} from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { TOOL_DECLARATIONS } from "../tools/toolSchemas.js";
import { handleToolCall } from "../tools/toolHandlers.js";

interface ChatSession {
  id: string;
  history: Content[];
  createdAt: number;
}

const sessions = new Map<string, ChatSession>();

function getOrCreateSession(sessionId: string): ChatSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { id: sessionId, history: [], createdAt: Date.now() };
    sessions.set(sessionId, session);
  }
  return session;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown>; result: unknown }[];
}

export interface ChatResponse {
  message: string;
  toolCalls?: { name: string; result: unknown }[];
  sessionId: string;
}

export async function processChat(
  sessionId: string,
  userMessage: string
): Promise<ChatResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
  });

  const session = getOrCreateSession(sessionId);

  // Add user message to history
  session.history.push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  const toolCallLog: { name: string; result: unknown }[] = [];

  // Iterative tool-calling loop
  let response: GenerateContentResult;
  let maxIterations = 10;

  while (maxIterations-- > 0) {
    response = await model.generateContent({
      contents: session.history,
    });

    const candidate = response.response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: FunctionCall } => "functionCall" in p
    );

    if (functionCalls.length === 0) {
      // No tool calls — this is the final text response
      const text = parts
        .filter((p): p is Part & { text: string } => "text" in p)
        .map((p) => p.text)
        .join("");

      session.history.push({
        role: "model",
        parts: [{ text }],
      });

      return {
        message: text,
        toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
        sessionId,
      };
    }

    // Execute tool calls
    session.history.push({
      role: "model",
      parts: functionCalls.map((fc) => ({ functionCall: fc.functionCall })),
    });

    const functionResponses: Part[] = [];
    for (const fc of functionCalls) {
      const { name, args } = fc.functionCall;
      const result = handleToolCall(name, (args ?? {}) as Record<string, unknown>);
      toolCallLog.push({ name, result });

      functionResponses.push({
        functionResponse: {
          name,
          response: result,
        },
      } as Part);
    }

    session.history.push({
      role: "function" as "user",
      parts: functionResponses,
    });
  }

  return {
    message: "I wasn't able to complete the assessment. Please try rephrasing your input.",
    sessionId,
  };
}

export function getSessionHistory(sessionId: string): Content[] {
  const session = sessions.get(sessionId);
  return session?.history ?? [];
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}
