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
import { validateSystemRegistry } from "./v2/systemRegistry.js";
const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.use(cors());
app.use(express.json());

// API routes
app.use("/api", chatRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Unknown API route" });
});

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

// Verify V2 system registry integrity before accepting requests.
validateSystemRegistry();

function startServer(port: number): void {
  const server = app.listen(port, () => {
    console.log(`GATIOD Chat Assistant running on http://localhost:${port}`);
    console.log(`  POST /api/chat — send a message`);
    console.log(`  POST /api/chat/reset — reset a session`);
    console.log(`  GET  /health — health check`);

    if (!process.env.GEMINI_API_KEY) {
      console.warn("\n⚠️  GEMINI_API_KEY not set — chat will fail until configured.");
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${port} in use, trying ${port + 1}…`);
      startServer(port + 1);
    } else {
      throw err;
    }
  });
}

startServer(PORT);
