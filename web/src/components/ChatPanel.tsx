import { useState, useRef, useEffect, useCallback } from "react";
import {
  Box, Paper, TextField, IconButton, Typography, CircularProgress, Button, Tooltip,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ConfirmationCard from "./ConfirmationCard";
import BreakdownView from "./BreakdownView";
import ToolCallIndicator from "./ToolCallIndicator";
import ReportExport from "./ReportExport";

interface ToolCall {
  name: string;
  result: { success: boolean; data?: Record<string, unknown> };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  suggestedChips?: string[];
  timestamp: number;
}

interface ApiResponse {
  message: string;
  toolCalls?: ToolCall[];
  suggestedChips?: string[];
  sessionId: string;
  error?: string;
}

const CONFIRMATION_PATTERN = /\*\*Confirmation\s*[—–-]\s*(?:Upper|Lower) Limb Assessment/i;
const ASSESSMENT_TOOLS = new Set(["assess_upper_limb", "assess_lower_limb"]);

function detectMessageType(content: string, toolCalls?: ToolCall[]): "confirmation" | "breakdown" | "text" {
  if (CONFIRMATION_PATTERN.test(content)) return "confirmation";
  const hasAssessResult = toolCalls?.some(
    (tc) => ASSESSMENT_TOOLS.has(tc.name) && tc.result?.success
  );
  if (hasAssessResult) return "breakdown";
  return "text";
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), sessionId }),
      });
      const data: ApiResponse = await res.json();

      if (data.error) throw new Error(data.error);

      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

      const assessCall = data.toolCalls?.find(
        (tc) => ASSESSMENT_TOOLS.has(tc.name) && tc.result?.success
      );
      if (assessCall?.result?.data) {
        setLastResult(assessCall.result.data as Record<string, unknown>);
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message,
        toolCalls: data.toolCalls as ToolCall[],
        suggestedChips: data.suggestedChips,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠️ ${err instanceof Error ? err.message : "Something went wrong. Please try again."}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [loading, sessionId]);

  const handleReset = useCallback(async () => {
    if (sessionId) {
      await fetch("/api/chat/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
    setMessages([]);
    setSessionId(null);
    setLastResult(null);
    setInput("");
  }, [sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", maxWidth: 900, mx: "auto", px: 2, py: 2 }}>
      {/* Messages */}
      <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 1.5, pb: 2 }}>
        {messages.length === 0 && (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box sx={{ textAlign: "center", maxWidth: 480 }}>
              <Typography variant="h5" sx={{ color: "primary.main", mb: 1 }}>
                Upper Limb Assessment
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.7 }}>
                Describe the clinical findings for your Upper Limb case. Include amputations, ROM measurements,
                neurological findings, and diagnosis-based conditions in any order.
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center" }}>
                {[
                  "Left shoulder, flexion 120°, abduction 90°",
                  "Suprascapular nerve, combined, partial",
                  "Above elbow amputation, right",
                  "OA shoulder moderate",
                ].map((hint) => (
                  <Button
                    key={hint}
                    size="small"
                    variant="outlined"
                    onClick={() => sendMessage(hint)}
                    sx={{ fontSize: "0.8rem", borderColor: "divider", color: "text.secondary", "&:hover": { borderColor: "primary.main", color: "primary.main" } }}
                  >
                    {hint}
                  </Button>
                ))}
              </Box>
            </Box>
          </Box>
        )}

        {messages.map((msg) => {
          const type = msg.role === "assistant" ? detectMessageType(msg.content, msg.toolCalls) : "text";

          return (
            <Box
              key={msg.id}
              sx={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "100%",
              }}
            >
              <Box sx={{ maxWidth: msg.role === "user" ? "70%" : "85%" }}>
                {msg.role === "user" ? (
                  <Paper sx={{ px: 2.5, py: 1.5, bgcolor: "primary.main", color: "#fff", borderRadius: "16px 16px 4px 16px" }}>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{msg.content}</Typography>
                  </Paper>
                ) : type === "confirmation" ? (
                  <ConfirmationCard content={msg.content} onConfirm={() => sendMessage("Confirmed.")} onEdit={(text) => sendMessage(text)} />
                ) : type === "breakdown" ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    <BreakdownView content={msg.content} toolCalls={msg.toolCalls} />
                    {msg.toolCalls && <ToolCallIndicator toolCalls={msg.toolCalls} />}
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <Paper sx={{ px: 2.5, py: 1.5, bgcolor: "background.paper", borderRadius: "16px 16px 16px 4px" }}>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.65, "& strong": { fontWeight: 600, color: "primary.main" } }}
                        dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
                      />
                    </Paper>
                    {msg.toolCalls && msg.toolCalls.length > 0 && <ToolCallIndicator toolCalls={msg.toolCalls} />}
                  </Box>
                )}
                {/* Smart contextual chips — shown for the last assistant message only */}
                {msg.role === "assistant" && msg.suggestedChips && msg.suggestedChips.length > 0 && msg.id === messages[messages.length - 1]?.id && !loading && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.5 }}>
                    {msg.suggestedChips.map((chip) => (
                      <Button
                        key={chip}
                        size="small"
                        variant="outlined"
                        onClick={() => sendMessage(chip)}
                        sx={{
                          fontSize: "0.78rem",
                          borderColor: "divider",
                          color: "text.secondary",
                          borderRadius: "16px",
                          px: 1.5,
                          py: 0.25,
                          minHeight: 28,
                          textTransform: "none",
                          fontWeight: 500,
                          lineHeight: 1.3,
                          "&:hover": {
                            borderColor: "secondary.main",
                            color: "secondary.main",
                            bgcolor: "rgba(46,125,111,0.04)",
                          },
                          transition: "all 0.15s",
                        }}
                      >
                        {chip}
                      </Button>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}

        {loading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, pl: 1 }}>
            <CircularProgress size={18} thickness={5} />
            <Typography variant="body2" color="text.secondary">Analysing findings…</Typography>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* Report export */}
      {lastResult && <ReportExport result={lastResult} />}

      {/* Input */}
      <Paper sx={{ display: "flex", alignItems: "flex-end", gap: 1, p: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          multiline
          maxRows={4}
          placeholder="Describe clinical findings…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          variant="standard"
          InputProps={{ disableUnderline: true }}
          sx={{ "& .MuiInputBase-input": { fontSize: "0.95rem", lineHeight: 1.5 } }}
        />
        <Tooltip title="Send">
          <span>
            <IconButton onClick={() => sendMessage(input)} disabled={!input.trim() || loading} color="primary" sx={{ bgcolor: input.trim() ? "primary.main" : "transparent", color: input.trim() ? "#fff" : "text.disabled", "&:hover": { bgcolor: "primary.dark" }, transition: "all 0.2s" }}>
              <SendIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="New assessment">
          <IconButton onClick={handleReset} size="small" sx={{ color: "text.secondary" }}>
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Paper>
    </Box>
  );
}

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br />");
}
