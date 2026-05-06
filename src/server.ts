/**
 * GATIOD Chat Assistant — Express Server
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { existsSync } from "fs";
import { join } from "path";
import { chatRouter } from "./api/chatRoutes.js";
import { getDb } from "./db/database.js";
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

// Serve frontend in production
const webDist = join(process.cwd(), "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(join(webDist, "index.html"));
  });
}

// Initialize database
getDb();

app.listen(PORT, () => {
  console.log(`GATIOD Chat Assistant running on http://localhost:${PORT}`);
  console.log(`  POST /api/chat — send a message`);
  console.log(`  POST /api/chat/reset — reset a session`);
  console.log(`  GET  /health — health check`);

  if (!process.env.GEMINI_API_KEY) {
    console.warn("\n⚠️  GEMINI_API_KEY not set — chat will fail until configured.");
  }
});
