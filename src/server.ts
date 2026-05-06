/**
 * GATIOD Chat Assistant — Express Server
 */

import express from "express";
import cors from "cors";
import { chatRouter } from "./api/chatRoutes.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.use(cors());
app.use(express.json());

// API routes
app.use("/api", chatRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gatiod-chat-assistant" });
});

app.listen(PORT, () => {
  console.log(`GATIOD Chat Assistant running on http://localhost:${PORT}`);
  console.log(`  POST /api/chat — send a message`);
  console.log(`  POST /api/chat/reset — reset a session`);
  console.log(`  GET  /health — health check`);

  if (!process.env.GEMINI_API_KEY) {
    console.warn("\n⚠️  GEMINI_API_KEY not set — chat will fail until configured.");
  }
});
