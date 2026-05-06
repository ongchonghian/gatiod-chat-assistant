import { useState } from "react";
import { Box, Paper, Typography, Button, TextField, Divider, Chip } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import EditNoteIcon from "@mui/icons-material/EditNote";
import VerifiedIcon from "@mui/icons-material/Verified";

interface ConfirmationCardProps {
  content: string;
  onConfirm: () => void;
  onEdit: (correction: string) => void;
}

interface ParsedConfirmation {
  system: string;
  side: string;
  sections: { label: string; value: string }[];
}

function parseConfirmation(content: string): ParsedConfirmation {
  const headerMatch = content.match(/Confirmation\s*[—–-]\s*([^([\n*]+?)(?:\s*\((\w+)\))?(?:\s*\*\*)?$/im);
  const system = headerMatch?.[1]?.trim() ?? "Assessment";
  const side = headerMatch?.[2] ?? "";

  const sections: { label: string; value: string }[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/\*\*(.+?):\*\*\s*(.*)/);
    if (match) {
      const label = match[1].trim();
      const value = match[2].trim() || "None reported";
      if (label.toLowerCase() !== "confirmation") {
        sections.push({ label, value });
      }
    } else {
      const bulletMatch = line.match(/^\*\s+(.+)/);
      if (bulletMatch && sections.length > 0) {
        const last = sections[sections.length - 1];
        last.value += "\n• " + bulletMatch[1].trim();
      }
    }
  }

  return { system, side, sections };
}

export default function ConfirmationCard({ content, onConfirm, onEdit }: ConfirmationCardProps) {
  const [editing, setEditing] = useState(false);
  const [correction, setCorrection] = useState("");
  const parsed = parseConfirmation(content);

  const handleEdit = () => {
    if (correction.trim()) {
      onEdit(correction.trim());
      setEditing(false);
      setCorrection("");
    }
  };

  return (
    <Paper
      sx={{
        overflow: "hidden",
        border: "2px solid",
        borderColor: "secondary.main",
        borderRadius: 3,
      }}
    >
      {/* Header */}
      <Box sx={{ px: 2.5, py: 1.5, bgcolor: "secondary.main", display: "flex", alignItems: "center", gap: 1 }}>
        <VerifiedIcon sx={{ fontSize: 20, color: "#fff" }} />
        <Typography variant="subtitle1" sx={{ color: "#fff", fontWeight: 600, flex: 1 }}>
          Confirmation — {parsed.system}{parsed.side ? ` (${parsed.side})` : ""}
        </Typography>
        <Chip label="Review required" size="small" sx={{ bgcolor: "rgba(255,255,255,0.2)", color: "#fff", fontSize: "0.7rem", fontWeight: 600, height: 22 }} />
      </Box>

      {/* Body */}
      <Box sx={{ px: 2.5, py: 2 }}>
        {parsed.sections.map((s, i) => (
          <Box key={i} sx={{ mb: i < parsed.sections.length - 1 ? 1.5 : 0 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.68rem" }}>
              {s.label}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
              {s.value.replace(/None reported/i, "—") || "—"}
            </Typography>
          </Box>
        ))}
      </Box>

      <Divider />

      {/* Actions */}
      <Box sx={{ px: 2.5, py: 1.5 }}>
        {editing ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Describe what to change (e.g. 'shoulder flexion should be 130')"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEdit(); } }}
              autoFocus
            />
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="small" variant="contained" onClick={handleEdit} disabled={!correction.trim()}>
                Send correction
              </Button>
              <Button size="small" onClick={() => { setEditing(false); setCorrection(""); }}>
                Cancel
              </Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={onConfirm}
              sx={{ fontWeight: 600 }}
            >
              Confirm & Calculate
            </Button>
            <Button
              variant="outlined"
              startIcon={<EditNoteIcon />}
              onClick={() => setEditing(true)}
              sx={{ borderColor: "divider" }}
            >
              Edit values
            </Button>
          </Box>
        )}
      </Box>
    </Paper>
  );
}
