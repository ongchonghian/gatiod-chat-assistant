/**
 * Chat API Routes
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { processChat, clearSession } from "../chat/chatService.js";

export const chatRouter = Router();

chatRouter.post("/chat", async (req: Request, res: Response) => {
  try {
    const { message, sessionId } = req.body as { message?: string; sessionId?: string };

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const sid = sessionId || uuidv4();
    const result = await processChat(sid, message);

    res.json(result);
  } catch (err) {
    console.error("Chat error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

chatRouter.post("/chat/reset", (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) {
    clearSession(sessionId);
  }
  res.json({ success: true });
});
