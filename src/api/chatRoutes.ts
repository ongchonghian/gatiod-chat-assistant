/**
 * Chat API Routes
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { processChat, clearSession } from "../chat/chatService.js";
import { getSessionAuditTrail } from "../db/auditLog.js";
import { listSessionsForUser } from "../db/sessionStore.js";

export const chatRouter = Router();

chatRouter.post("/chat", async (req: Request, res: Response) => {
  try {
    const { message, sessionId, userId, claimId } = req.body as {
      message?: string; sessionId?: string; userId?: string; claimId?: string;
    };

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const sid = sessionId || uuidv4();
    const result = await processChat(sid, message, { userId, claimId });

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

/** Get the full audit trail for a session — medico-legal traceability. */
chatRouter.get("/chat/audit/:sessionId", (req: Request, res: Response) => {
  const sid = req.params.sessionId as string;
  const trail = getSessionAuditTrail(sid);
  res.json({ sessionId: sid, events: trail });
});

/** List sessions for a user (for session resume). */
chatRouter.get("/chat/sessions/:userId", (req: Request, res: Response) => {
  const uid = req.params.userId as string;
  const sessions = listSessionsForUser(uid);
  res.json({ userId: req.params.userId, sessions: sessions.map((s) => ({
    id: s.id, claimId: s.claimId, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt,
  })) });
});
